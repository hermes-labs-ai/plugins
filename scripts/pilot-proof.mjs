#!/usr/bin/env node

// Hermes Pilot Proof Pack.
//
// Certifies catalog entries against a real host runtime instead of asserting
// compatibility editorially. For each selected entry the run performs the
// public install lifecycle over HTTPS, reads back the component inventory the
// host actually loaded, compares it against the declared capabilities,
// uninstalls, and restores the host to its pre-run marketplace and plugin
// state. Teardown runs even when the run fails part way through.
//
//   node scripts/pilot-proof.mjs --host claude
//   node scripts/pilot-proof.mjs --host claude --plugin lintlang --out /tmp/one.json
//   node scripts/pilot-proof.mjs --host claude --keep    # leave state installed
//
// `--keep` deliberately marks the receipt `restored: false`, which makes it
// inadmissible to `verify.mjs`. It is a debugging aid, not a way to certify.
//
// The emitted receipt is evidence, not generated output: it is not required to
// be byte-reproducible. What is enforced elsewhere is that every entry marked
// `verified` for a certifiable host has a passing result in the committed
// receipt for the same pinned commit.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { json, readCatalog, root } from './catalog-lib.mjs';
import { evaluate, namesFrom, parseInventory, stripAnsi } from './pilot-proof-lib.mjs';

const SUPPORTED_HOSTS = new Set(['claude']);
const MARKETPLACE_REF = 'hermes-labs-ai/plugins';
const MARKETPLACE_NAME = 'hermes-labs';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  const value = index === -1 ? fallback : argv[index + 1];
  return typeof value === 'string' && value.startsWith('--') ? fallback : value;
};

const host = flag('host', 'claude');
const only = flag('plugin');
const keep = argv.includes('--keep');

if (!SUPPORTED_HOSTS.has(host)) {
  // Codex and Copilot install the same pinned sources, but neither CLI exposes
  // a component inventory readback, so a run there could prove the lifecycle
  // and nothing about loaded capabilities. Refuse rather than imply otherwise.
  console.error(`unsupported host: ${host} (component-inventory readback is required for certification)`);
  process.exit(2);
}

const run = (args) => {
  const result = spawnSync('claude', args, { encoding: 'utf8' });
  return {
    command: `claude ${args.join(' ')}`,
    status: result.status ?? -1,
    stdout: stripAnsi(result.stdout ?? '').trim(),
    stderr: stripAnsi(result.stderr ?? '').trim(),
  };
};

// `claude plugin details` reports slash commands inside the Skills bucket, so
// the inventory alone cannot separate `skill` from `command`. The installed
// tree can. This reads host cache internals and is allowed to come back
// unresolved rather than guess.
function inspectInstalledTree(id, version) {
  const base = resolve(homedir(), '.claude/plugins/cache', MARKETPLACE_NAME, id, version);
  const entries = (name) => {
    const directory = resolve(base, name);
    if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
    return readdirSync(directory).filter((entry) => !entry.startsWith('.'));
  };
  try {
    if (!existsSync(base)) return { resolved: false, path: null, skills: null, commands: null };
    return { resolved: true, path: base, skills: entries('skills'), commands: entries('commands') };
  } catch {
    // An unreadable cache must degrade to unresolved, never to a silent pass.
    return { resolved: false, path: base, skills: null, commands: null };
  }
}

const catalog = await readCatalog();
const targets = catalog.plugins
  .filter((plugin) => plugin.compatibility?.[host] !== 'unsupported')
  .filter((plugin) => !only || plugin.id === only);

if (targets.length === 0) {
  console.error(`no ${host} targets selected${only ? ` for --plugin ${only}` : ''}`);
  process.exit(1);
}

const version = run(['--version']);
if (version.status !== 0) {
  console.error(`claude CLI is not usable: ${version.stderr || version.stdout}`);
  process.exit(1);
}

const readState = () => ({
  marketplaces: namesFrom(run(['plugin', 'marketplace', 'list']).stdout),
  plugins: namesFrom(run(['plugin', 'list']).stdout),
});

const baseline = readState();
const marketplacePreexisting = baseline.marketplaces.includes(MARKETPLACE_NAME);

const steps = [];
const capture = (result) => {
  steps.push({ command: result.command, status: result.status });
  return result;
};

const results = [];
const pendingUninstall = new Set();
let marketplaceAdded = false;
let runError = null;

try {
  if (!marketplacePreexisting) {
    const added = capture(run(['plugin', 'marketplace', 'add', MARKETPLACE_REF]));
    if (added.status !== 0) throw new Error(`marketplace add failed: ${added.stderr || added.stdout}`);
    marketplaceAdded = true;
    if (!/cloning via HTTPS/i.test(added.stdout)) {
      throw new Error('marketplace was not fetched over public HTTPS');
    }
  }

  for (const plugin of targets) {
    const reference = `${plugin.id}@${MARKETPLACE_NAME}`;
    const installed = capture(run(['plugin', 'install', reference]));
    if (installed.status !== 0) {
      results.push({
        id: plugin.id,
        version: plugin.version,
        declared: plugin.capabilities,
        verdict: 'fail',
        error: installed.stderr || installed.stdout,
      });
      continue;
    }
    pendingUninstall.add(reference);

    const details = capture(run(['plugin', 'details', reference]));
    const inventory = parseInventory(details.stdout);
    const tree = inspectInstalledTree(plugin.id, plugin.version);
    const { checks, verdict } = evaluate(plugin, inventory, tree);

    const removed = capture(run(['plugin', 'uninstall', reference]));
    if (removed.status === 0) pendingUninstall.delete(reference);

    results.push({
      id: plugin.id,
      version: plugin.version,
      declared: plugin.capabilities,
      compatibility: plugin.compatibility[host],
      source: { repository: plugin.repository, commit: plugin.source.commit, path: plugin.source.path },
      observed: {
        inventory,
        installedTree: { resolved: tree.resolved, skills: tree.skills, commands: tree.commands },
      },
      checks,
      verdict,
      lifecycle: { install: installed.status, details: details.status, uninstall: removed.status },
    });
  }
} catch (error) {
  runError = error;
} finally {
  if (!keep) {
    // Roll back whatever this run installed, including after a mid-run failure.
    for (const reference of pendingUninstall) capture(run(['plugin', 'uninstall', reference]));
    if (marketplaceAdded) capture(run(['plugin', 'marketplace', 'remove', MARKETPLACE_NAME]));
  }
}

const finalState = readState();
const restored = !keep
  && JSON.stringify(finalState.marketplaces) === JSON.stringify(baseline.marketplaces)
  && JSON.stringify(finalState.plugins) === JSON.stringify(baseline.plugins);

const receipt = {
  schemaVersion: 1,
  kind: 'pilot-proof',
  host,
  hostVersion: version.stdout,
  marketplace: {
    ref: MARKETPLACE_REF,
    name: MARKETPLACE_NAME,
    transport: 'https',
    preexisting: marketplacePreexisting,
  },
  catalogVersion: catalog.catalog.version,
  baseline,
  finalState,
  restored,
  ...(runError ? { error: runError.message } : {}),
  results,
  summary: {
    total: results.length,
    pass: results.filter((result) => result.verdict === 'pass').length,
    fail: results.filter((result) => result.verdict === 'fail').length,
    unresolved: results.filter((result) => result.verdict === 'unresolved').length,
  },
  steps,
};

// Neither a failed run nor a single-entry run may clobber the committed
// receipt, which has to keep covering every certifiable entry.
const explicitOut = flag('out');
const partial = Boolean(runError) || only !== null;
const canonical = resolve(root, `evidence/pilot-proof-${host}.json`);
const out = explicitOut ?? (partial ? `${canonical}.partial.json` : canonical);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, json(receipt));

const { pass, fail, unresolved, total } = receipt.summary;
if (runError) console.error(`run failed: ${runError.message}`);
console.log(`pilot proof (${host}): ${pass}/${total} pass, ${fail} fail, ${unresolved} unresolved`);
console.log(`host state restored: ${restored}`);
console.log(`receipt: ${out}${partial ? ' (partial run)' : ''}`);

if (runError || fail > 0 || !restored) process.exit(1);
