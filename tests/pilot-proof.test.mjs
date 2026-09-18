import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relativePath) => JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'));

const catalog = readJson('catalog.json');
const receipt = readJson('evidence/pilot-proof-claude.json');
const byId = new Map(receipt.results.map((result) => [result.id, result]));

test('the receipt describes a restored run of the current catalog', () => {
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.kind, 'pilot-proof');
  assert.equal(receipt.host, 'claude');
  assert.equal(receipt.marketplace.ref, 'hermes-labs-ai/plugins');
  assert.match(receipt.marketplace.commit, /^[0-9a-f]{40}$/);
  assert.equal(typeof receipt.marketplace.sourceRef, 'string');
  assert.ok(receipt.marketplace.sourceRef.length > 0);
  assert.equal(receipt.marketplace.resolvedRef, `${receipt.marketplace.ref}@${receipt.marketplace.sourceRef}`);
  assert.equal(receipt.marketplace.transport, 'https');
  assert.equal(receipt.marketplace.preexisting, false);
  assert.equal(receipt.restored, true, 'a run that dirtied the host is not admissible evidence');
});

test('every claude-targeted entry was exercised', () => {
  const targeted = catalog.plugins
    .filter((plugin) => plugin.compatibility.claude !== 'unsupported')
    .map((plugin) => plugin.id);
  assert.deepEqual([...byId.keys()].sort(), [...targeted].sort());
});

test('every verified claude entry is backed by a passing result for the pinned commit', () => {
  for (const plugin of catalog.plugins) {
    if (plugin.compatibility.claude !== 'verified') continue;
    const result = byId.get(plugin.id);
    assert.ok(result, `${plugin.id}: no pilot-proof result`);
    assert.equal(result.verdict, 'pass', plugin.id);
    assert.equal(result.source.commit, plugin.source.commit, plugin.id);
    assert.equal(result.version, plugin.version, plugin.id);
  }
});

test('each result checks the declared capabilities against observed runtime state', () => {
  for (const result of receipt.results) {
    const plugin = catalog.plugins.find((candidate) => candidate.id === result.id);
    assert.ok(plugin, result.id);
    assert.deepEqual(result.declared, plugin.capabilities, result.id);
    const checked = new Set(result.checks.map((check) => check.capability));
    // Every declared capability must be checked, not merely the probed baseline.
    for (const capability of plugin.capabilities) {
      assert.ok(checked.has(capability), `${result.id}: ${capability} declared but never checked`);
    }
    for (const capability of ['command', 'hook', 'mcp', 'skill']) {
      assert.ok(checked.has(capability), `${result.id}: ${capability} baseline check missing`);
    }
    assert.ok(result.checks.length > 0, `${result.id}: no certification checks`);
    for (const check of result.checks) {
      assert.equal(check.declared, plugin.capabilities.includes(check.capability), `${result.id}/${check.capability}`);
      assert.equal(check.status, 'pass', `${result.id}/${check.capability}`);
    }
  }
});

test('the lifecycle completed for every exercised entry', () => {
  for (const result of receipt.results) {
    assert.equal(result.lifecycle.install, 0, `${result.id}: install`);
    assert.equal(result.lifecycle.details, 0, `${result.id}: details`);
    assert.equal(result.lifecycle.uninstall, 0, `${result.id}: uninstall`);
  }
});

test('no recorded host command failed', () => {
  const failed = receipt.steps.filter((step) => step.status !== 0);
  assert.deepEqual(failed, []);
});
