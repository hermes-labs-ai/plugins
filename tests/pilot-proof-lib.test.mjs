import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHECKABLE_CAPABILITIES, evaluate, namesFrom, parseInventory } from '../scripts/pilot-proof-lib.mjs';

const BULLET = '❯';
const resolved = (skills = [], commands = []) => ({ resolved: true, skills, commands });
const unresolved = { resolved: false, skills: null, commands: null };
const statusOf = (result, capability) => result.checks.find((check) => check.capability === capability)?.status;

const DETAILS = [
  'Component inventory',
  '  Skills (3)  check, intent-verify, map',
  '  Agents (0)',
  '  Hooks (1)  PostToolUse  (harness-only)',
  '  MCP servers (0)',
  '  LSP servers (0)',
].join('\n');

test('parseInventory reads counts and strips host commentary from names', () => {
  const inventory = parseInventory(DETAILS);
  assert.equal(inventory.skills.count, 3);
  assert.deepEqual(inventory.skills.names, ['check', 'intent-verify', 'map']);
  assert.equal(inventory.hooks.count, 1);
  assert.deepEqual(inventory.hooks.names, ['PostToolUse']);
  assert.equal(inventory.mcpServers.count, 0);
  assert.deepEqual(inventory.mcpServers.names, []);
});

test('parseInventory tolerates ANSI colouring', () => {
  const coloured = `  [32mSkills[39m (1)  only-one`;
  assert.equal(parseInventory(coloured).skills.count, 1);
});

test('namesFrom keeps the first token so decoration cannot hide a marketplace', () => {
  const output = [
    'Configured marketplaces:',
    `  ${BULLET} claude-plugins-official`,
    `  ${BULLET} hermes-labs   (declared in user settings)`,
  ].join('\n');
  assert.deepEqual(namesFrom(output), ['claude-plugins-official', 'hermes-labs']);
});

test('a declared capability present at runtime passes', () => {
  const plugin = { capabilities: ['skill', 'hook'] };
  const inventory = parseInventory('  Hooks (1)  PostToolUse\n  MCP servers (0)');
  const result = evaluate(plugin, inventory, resolved(['audit'], []));
  assert.equal(result.verdict, 'pass');
});

test('a declared capability missing at runtime fails', () => {
  const plugin = { capabilities: ['skill', 'hook'] };
  const inventory = parseInventory('  Hooks (0)\n  MCP servers (0)');
  const result = evaluate(plugin, inventory, resolved(['audit'], []));
  assert.equal(statusOf(result, 'hook'), 'fail');
  assert.equal(result.verdict, 'fail');
});

test('an undeclared capability present at runtime fails', () => {
  const plugin = { capabilities: ['skill'] };
  const inventory = parseInventory('  Hooks (2)  SessionStart, Stop\n  MCP servers (0)');
  const result = evaluate(plugin, inventory, resolved(['audit'], []));
  assert.equal(statusOf(result, 'hook'), 'fail');
  assert.equal(result.verdict, 'fail');
});

test('an unresolved installed tree never certifies as pass', () => {
  const plugin = { capabilities: ['skill'] };
  const inventory = parseInventory('  Hooks (0)\n  MCP servers (0)');
  const result = evaluate(plugin, inventory, unresolved);
  assert.equal(statusOf(result, 'skill'), 'unresolved');
  assert.equal(statusOf(result, 'command'), 'unresolved');
  assert.equal(result.verdict, 'unresolved');
});

test('skill and command are judged separately from the installed tree', () => {
  const inventory = parseInventory('  Hooks (0)\n  MCP servers (0)');
  const commandsOnly = evaluate({ capabilities: ['command'] }, inventory, resolved([], ['run.md']));
  assert.equal(commandsOnly.verdict, 'pass');
  const misdeclared = evaluate({ capabilities: ['skill'] }, inventory, resolved([], ['run.md']));
  assert.equal(statusOf(misdeclared, 'skill'), 'fail');
  assert.equal(statusOf(misdeclared, 'command'), 'fail');
});

test('a declared capability with no runtime probe fails instead of passing by omission', () => {
  for (const capability of ['agent', 'lsp']) {
    assert.ok(!CHECKABLE_CAPABILITIES.has(capability));
    const inventory = parseInventory('  Hooks (0)\n  MCP servers (0)');
    const result = evaluate({ capabilities: [capability] }, inventory, resolved([], []));
    assert.equal(statusOf(result, capability), 'fail', capability);
    assert.equal(result.verdict, 'fail', capability);
  }
});
