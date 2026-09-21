// Pure helpers for the pilot proof pack, kept separate from the runner so the
// parsing and judgement logic can be unit tested without touching a real host.

// Capabilities this pack knows how to probe at runtime. `schema/catalog.schema.json`
// also permits `agent` and `lsp`; anything outside this set is failed loudly by
// `evaluate` rather than quietly omitted from the checks.
export const CHECKABLE_CAPABILITIES = new Set(['skill', 'mcp', 'hook', 'command']);

export const stripAnsi = (value) => value.replace(/\[[0-9;]*m/g, '');

const BULLET = '❯';

// Reads the names out of `claude plugin list` / `plugin marketplace list`.
// Only the first whitespace-delimited token is kept, so decoration appended to
// a line cannot make an existing marketplace look absent, which would otherwise
// cause teardown to remove a marketplace the user already had.
export const namesFrom = (output) => stripAnsi(output)
  .split('\n')
  .filter((line) => line.includes(BULLET))
  .map((line) => line.slice(line.indexOf(BULLET) + 1).trim().split(/\s+/)[0])
  .filter(Boolean);

// The host prints one line per component class:
//   Skills (3)  check, intent-verify, map
//   Hooks (1)  PostToolUse  (harness-only ...)
const INVENTORY = /^\s*(Skills|Agents|Hooks|MCP servers|LSP servers)\s+\((\d+)\)\s*(.*)$/;
const INVENTORY_KEY = {
  Skills: 'skills',
  Agents: 'agents',
  Hooks: 'hooks',
  'MCP servers': 'mcpServers',
  'LSP servers': 'lspServers',
};

export function parseInventory(output) {
  const inventory = {};
  for (const line of stripAnsi(output).split('\n')) {
    const match = INVENTORY.exec(line);
    if (!match) continue;
    const [, label, count, rest] = match;
    inventory[INVENTORY_KEY[label]] = {
      count: Number(count),
      // Trailing parenthetical annotations are host commentary, not names.
      names: rest.replace(/\s*\(.*$/, '').split(',').map((name) => name.trim()).filter(Boolean),
    };
  }
  return inventory;
}

export function evaluate(plugin, inventory, tree) {
  const declared = new Set(plugin.capabilities);
  const checks = [];
  const record = (capability, expected, observed, note = null) => {
    const status = observed === null ? 'unresolved' : expected === observed ? 'pass' : 'fail';
    checks.push({ capability, declared: expected, observed, status, ...(note ? { note } : {}) });
  };

  // Host inventory is authoritative for these classes.
  record('hook', declared.has('hook'), (inventory.hooks?.count ?? 0) > 0);
  record('mcp', declared.has('mcp'), (inventory.mcpServers?.count ?? 0) > 0);

  // The installed tree is authoritative for skill vs command.
  const note = 'host reports skills and commands in one Skills bucket; separated from the installed tree';
  record('skill', declared.has('skill'), tree.resolved ? tree.skills.length > 0 : null, note);
  record('command', declared.has('command'), tree.resolved ? tree.commands.length > 0 : null, note);

  // A declared capability with no runtime probe must not certify by omission.
  for (const capability of plugin.capabilities) {
    if (CHECKABLE_CAPABILITIES.has(capability)) continue;
    checks.push({
      capability,
      declared: true,
      observed: null,
      status: 'fail',
      note: 'no runtime probe is implemented for this capability',
    });
  }

  const verdict = checks.some((check) => check.status === 'fail')
    ? 'fail'
    : checks.some((check) => check.status === 'unresolved')
      ? 'unresolved'
      : 'pass';
  return { checks, verdict };
}
