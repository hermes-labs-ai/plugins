import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relativePath) => JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'));
const digest = (relativePath) => createHash('sha256')
  .update(readFileSync(resolve(root, relativePath)))
  .digest('hex');

const catalog = readJson('catalog.json');
const claude = readJson('.claude-plugin/marketplace.json');
const codex = readJson('.agents/plugins/marketplace.json');
const copilot = readJson('.github/plugin/marketplace.json');

test('migration preserves the two installed marketplace namespaces', () => {
  assert.equal(claude.name, 'hermes-labs');
  assert.equal(codex.name, 'hermes-labs');
  assert.equal(copilot.name, 'hermes-labs-copilot');
});

test('the complete host inventories are mapped once per host in catalog.json', () => {
  assert.equal(catalog.plugins.length, 15);
  for (const host of ['claude', 'codex', 'copilot']) {
    const entries = catalog.plugins.filter((plugin) => plugin.targets.includes(host));
    assert.equal(new Set(entries.map((plugin) => plugin.id)).size, entries.length);
  }
  assert.equal(claude.plugins.length, 13);
  assert.equal(copilot.plugins.length, 13);
  assert.deepEqual(
    claude.plugins.map((plugin) => plugin.name),
    catalog.plugins.filter((plugin) => plugin.targets.includes('claude')).map((plugin) => plugin.id),
  );
  assert.deepEqual(
    copilot.plugins.map((plugin) => plugin.name),
    catalog.plugins.filter((plugin) => plugin.targets.includes('copilot')).map((plugin) => plugin.id),
  );
});

test('every catalog source is immutable and avoids organization SSH dependencies', () => {
  for (const plugin of catalog.plugins) {
    assert.match(plugin.source.commit, /^[0-9a-f]{40}$/, plugin.id);
    assert.match(plugin.repository, /^https:\/\/github\.com\/hermes-labs-ai\//, plugin.id);
    for (const [host, manifest] of [['claude', claude], ['codex', codex], ['copilot', copilot]]) {
      if (!plugin.targets.includes(host)) continue;
      const entry = manifest.plugins.find((candidate) => candidate.name === plugin.id);
      assert.ok(entry, `${manifest.name}/${plugin.id}`);
      assert.equal(entry.source.sha, plugin.source.commit, `${manifest.name}/${plugin.id}`);
      assert.match(entry.source.url, /^https:\/\//, `${manifest.name}/${plugin.id}`);
      assert.doesNotMatch(entry.source.url, /^(git@|ssh:|git:)/, `${manifest.name}/${plugin.id}`);
    }
  }
});

test('LintLang keeps its stable name but selects the native Copilot package', () => {
  const claudeLintlang = claude.plugins.find((plugin) => plugin.name === 'lintlang');
  const copilotLintlang = copilot.plugins.find((plugin) => plugin.name === 'lintlang');
  assert.equal(claudeLintlang.source.path, 'integrations/claude-code');
  assert.equal(copilotLintlang.source.path, 'integrations/copilot-cli');
  assert.equal(copilotLintlang.version, '0.1.0');
});

test('the generator is byte-for-byte deterministic', () => {
  const paths = [
    '.claude-plugin/marketplace.json',
    '.agents/plugins/marketplace.json',
    '.github/plugin/marketplace.json',
  ];
  const before = paths.map(digest);
  execFileSync(process.execPath, [resolve(root, 'scripts/generate.mjs')], { cwd: root });
  assert.deepEqual(paths.map(digest), before);
});

test('the historical Copilot feed is generated from the same catalog', () => {
  const temporary = mkdtempSync(resolve(tmpdir(), 'hermes-compat-'));
  const output = resolve(temporary, '.claude-plugin/marketplace.json');
  try {
    execFileSync(process.execPath, [
      resolve(root, 'scripts/generate.mjs'),
      '--only-compat',
      '--compat-output',
      output,
    ], { cwd: root });
    const compatibility = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(compatibility.name, 'hermes-labs-copilot');
    assert.deepEqual(
      compatibility.plugins.map((plugin) => plugin.name),
      copilot.plugins.map((plugin) => plugin.name),
    );
    assert.equal(compatibility.plugins[0].source.source, 'git-subdir');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('Codex entries include required policy metadata and only supported Git sources', () => {
  for (const plugin of codex.plugins) {
    assert.deepEqual(plugin.policy, {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL',
    });
    assert.ok(['url', 'git-subdir'].includes(plugin.source.source));
    assert.equal(typeof plugin.category, 'string');
    assert.ok(plugin.category.length > 0);
  }
});

test('hermes-blind exercises portable skill generation', () => {
  const plugin = catalog.plugins.find((candidate) => candidate.id === 'hermes-blind');
  assert.deepEqual(plugin.capabilities, ['skill']);
  assert.deepEqual(plugin.targets, ['claude', 'codex', 'copilot']);
  assert.equal(plugin.source.path, 'claude-plugin');
});

test('claude-trash-guard remains a host hook, not a portable Codex claim', () => {
  const plugin = catalog.plugins.find((candidate) => candidate.id === 'claude-trash-guard');
  assert.deepEqual(plugin.capabilities, ['hook']);
  assert.deepEqual(plugin.targets, ['claude', 'copilot']);
  assert.equal(plugin.compatibility.codex, 'unsupported');
  assert.equal(codex.plugins.some((candidate) => candidate.name === plugin.id), false);
});

test('Copilot native manifest cannot be shadowed by a higher-precedence root path', async () => {
  await assert.rejects(access(resolve(root, 'marketplace.json')));
  await assert.rejects(access(resolve(root, '.plugin/marketplace.json')));
  await access(resolve(root, '.github/plugin/marketplace.json'));
});

test('repository is a distribution catalog, not a copy of product implementations', async () => {
  await assert.rejects(access(resolve(root, 'plugins')));
});
