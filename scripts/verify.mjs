#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { externalSource, json, pluginsFor, readCatalog, root } from './catalog-lib.mjs';

const network = process.argv.includes('--network');
const errors = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

const catalog = await readCatalog();
check(catalog.schemaVersion === 1, 'catalog.schemaVersion must be 1');
check(Array.isArray(catalog.plugins) && catalog.plugins.length > 0, 'catalog.plugins must be non-empty');
check(catalog.catalog?.namespaces?.claude === 'hermes-labs', 'Claude namespace must remain hermes-labs');
check(catalog.catalog?.namespaces?.codex === 'hermes-labs', 'Codex namespace must remain hermes-labs');
check(catalog.catalog?.namespaces?.copilot === 'hermes-labs-copilot', 'Copilot namespace must remain hermes-labs-copilot');

const idsByHost = Object.fromEntries(['claude', 'codex', 'copilot'].map((host) => [host, new Set()]));
for (const plugin of catalog.plugins) {
  check(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(plugin.id), `${plugin.id}: invalid id`);
  check(/^https:\/\/github\.com\/hermes-labs-ai\/[A-Za-z0-9_.-]+$/.test(plugin.repository), `${plugin.id}: invalid repository`);
  check(/^[0-9a-f]{40}$/.test(plugin.source?.commit ?? ''), `${plugin.id}: commit must be a full SHA`);
  check(typeof plugin.source?.path === 'string' && plugin.source.path.length > 0, `${plugin.id}: source.path is required`);
  check(Array.isArray(plugin.targets) && plugin.targets.length > 0, `${plugin.id}: targets are required`);
  check(new Set(plugin.targets).size === plugin.targets.length, `${plugin.id}: duplicate target`);
  for (const host of plugin.targets) {
    check(!idsByHost[host]?.has(plugin.id), `${plugin.id}: duplicate ${host} id`);
    idsByHost[host]?.add(plugin.id);
  }
  for (const host of ['claude', 'codex', 'copilot']) {
    const status = plugin.compatibility?.[host];
    check(['verified', 'listed-unverified', 'unsupported'].includes(status), `${plugin.id}: invalid ${host} compatibility`);
    check(plugin.targets.includes(host) === (status !== 'unsupported'), `${plugin.id}: ${host} target and compatibility disagree`);
  }
}

const expectedCounts = { claude: 13, copilot: 13 };
for (const [host, expected] of Object.entries(expectedCounts)) {
  check(pluginsFor(catalog, host).length === expected, `${host}: expected preserved inventory of ${expected}`);
}

const generated = [
  ['.claude-plugin/marketplace.json', 'claude'],
  ['.agents/plugins/marketplace.json', 'codex'],
  ['.github/plugin/marketplace.json', 'copilot'],
];

for (const [relativePath, host] of generated) {
  const manifest = JSON.parse(await readFile(resolve(root, relativePath), 'utf8'));
  check(manifest.name === catalog.catalog.namespaces[host], `${relativePath}: namespace mismatch`);
  const expected = pluginsFor(catalog, host);
  check(manifest.plugins.length === expected.length, `${relativePath}: plugin count mismatch`);
  check(
    manifest.plugins.map((plugin) => plugin.name).join('\n') === expected.map((plugin) => plugin.id).join('\n'),
    `${relativePath}: plugin order or membership differs from catalog.json`,
  );
  for (const plugin of expected) {
    const entry = manifest.plugins.find((candidate) => candidate.name === plugin.id);
    check(json(entry.source) === json(externalSource(plugin, host)), `${relativePath}: ${plugin.id} source is not deterministic`);
  }
}

// Hosts whose runtime the pilot proof pack can actually certify. For these,
// `verified` has to be backed by a receipt for the exact pinned commit:
// bumping a pin without re-certifying fails here, and downgrading the entry to
// `listed-unverified` is the other legitimate way to clear it. Reading the
// committed receipt keeps this check available in CI, where no agent host CLI
// is installed.
//
// Codex and Copilot are absent on purpose. Neither CLI exposes a component
// inventory readback, so no receipt can exist for them, and the `verified`
// entries they already carry rest on earlier manual checks rather than on this
// mechanism. That asymmetry is documented in README.md rather than papered over
// by gating hosts this pack cannot actually prove.
const CERTIFIED_HOSTS = ['claude'];

for (const host of CERTIFIED_HOSTS) {
  const receiptPath = `evidence/pilot-proof-${host}.json`;
  let receipt;
  try {
    receipt = JSON.parse(await readFile(resolve(root, receiptPath), 'utf8'));
  } catch (error) {
    errors.push(`${receiptPath}: missing or unreadable pilot-proof receipt (${error.code ?? error.message})`);
    continue;
  }

  check(receipt.schemaVersion === 1, `${receiptPath}: unsupported schemaVersion`);
  check(receipt.kind === 'pilot-proof', `${receiptPath}: unexpected receipt kind ${receipt.kind}`);
  check(receipt.host === host, `${receiptPath}: receipt host is ${receipt.host}`);
  check(receipt.catalogVersion === catalog.catalog.version, `${receiptPath}: catalog version ${receipt.catalogVersion} does not match ${catalog.catalog.version}`);
  check(receipt.marketplace?.ref === 'hermes-labs-ai/plugins', `${receiptPath}: unexpected marketplace ref ${receipt.marketplace?.ref}`);
  check(/^[0-9a-f]{40}$/.test(receipt.marketplace?.commit ?? ''), `${receiptPath}: marketplace commit must be a full SHA`);
  check(typeof receipt.marketplace?.sourceRef === 'string' && receipt.marketplace.sourceRef.length > 0, `${receiptPath}: marketplace sourceRef is missing`);
  check(receipt.marketplace?.resolvedRef === `${receipt.marketplace?.ref}@${receipt.marketplace?.sourceRef}`, `${receiptPath}: marketplace resolvedRef does not match its source ref`);
  check(receipt.marketplace?.preexisting === false, `${receiptPath}: certification must start without a pre-existing Hermes marketplace`);
  check(receipt.restored === true, `${receiptPath}: run did not restore host state, so its evidence is not trustworthy`);
  check(Array.isArray(receipt.steps) && receipt.steps.length > 0, `${receiptPath}: command evidence is missing`);
  if (Array.isArray(receipt.steps)) {
    for (const step of receipt.steps) {
      check(step.status === 0, `${receiptPath}: command failed: ${step.command}`);
    }
  }

  const byId = new Map((receipt.results ?? []).map((result) => [result.id, result]));
  for (const plugin of catalog.plugins) {
    if (plugin.compatibility?.[host] !== 'verified') continue;
    const result = byId.get(plugin.id);
    if (!result) {
      errors.push(`${plugin.id}: ${host} compatibility is verified but ${receiptPath} has no result`);
      continue;
    }
    check(result.verdict === 'pass', `${plugin.id}: ${host} certification verdict is ${result.verdict}`);
    check(result.lifecycle?.install === 0, `${plugin.id}: install lifecycle status is ${result.lifecycle?.install}`);
    check(result.lifecycle?.details === 0, `${plugin.id}: details lifecycle status is ${result.lifecycle?.details}`);
    check(result.lifecycle?.uninstall === 0, `${plugin.id}: uninstall lifecycle status is ${result.lifecycle?.uninstall}`);
    check(Array.isArray(result.checks) && result.checks.length > 0, `${plugin.id}: certification checks are missing`);
    if (Array.isArray(result.checks)) {
      for (const evidenceCheck of result.checks) {
        check(evidenceCheck.status === 'pass', `${plugin.id}: ${evidenceCheck.capability ?? 'unknown'} check is ${evidenceCheck.status}`);
      }
    }
    check(
      json(result.declared) === json(plugin.capabilities),
      `${plugin.id}: certified capabilities do not match the catalog`,
    );
    check(
      result.source?.commit === plugin.source.commit,
      `${plugin.id}: certified commit ${result.source?.commit} does not match pinned ${plugin.source.commit}; re-run scripts/pilot-proof.mjs`,
    );
    check(
      result.version === plugin.version,
      `${plugin.id}: certified version ${result.version} does not match catalog ${plugin.version}`,
    );
  }
}

for (const forbidden of ['marketplace.json', '.plugin/marketplace.json']) {
  try {
    await readFile(resolve(root, forbidden));
    errors.push(`${forbidden}: forbidden higher-precedence Copilot manifest shadows .github/plugin/marketplace.json`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const generate = spawnSync(process.execPath, [resolve(root, 'scripts/generate.mjs')], {
  cwd: root,
  encoding: 'utf8',
});
check(generate.status === 0, `generate.mjs failed: ${generate.stderr.trim()}`);

if (network) {
  for (const plugin of catalog.plugins) {
    const manifestName = plugin.targets.includes('claude')
      ? '.claude-plugin/plugin.json'
      : 'plugin.json';
    const manifestPath = plugin.source.path === '.'
      ? manifestName
      : `${plugin.source.path}/${manifestName}`;
    const slug = new URL(plugin.repository).pathname.replace(/^\//, '');
    const url = `https://raw.githubusercontent.com/${slug}/${plugin.source.commit}/${manifestPath}`;
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      errors.push(`${plugin.id}: could not fetch pinned manifest: ${error.message}`);
      continue;
    }
    check(response.ok, `${plugin.id}: pinned manifest returned HTTP ${response.status}`);
    if (!response.ok) continue;
    try {
      const manifest = await response.json();
      check(manifest.name === plugin.id, `${plugin.id}: pinned manifest name is ${manifest.name}`);
      check(manifest.version === plugin.version, `${plugin.id}: pinned manifest version is ${manifest.version}, expected ${plugin.version}`);
    } catch (error) {
      errors.push(`${plugin.id}: pinned manifest is not valid JSON: ${error.message}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(`verified ${catalog.plugins.length} catalog entries${network ? ' with pinned upstream manifests' : ''}`);
