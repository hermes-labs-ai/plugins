# hermes-labs-ai/plugins

[![validate-catalog](https://github.com/hermes-labs-ai/plugins/actions/workflows/validate-marketplace.yml/badge.svg)](https://github.com/hermes-labs-ai/plugins/actions/workflows/validate-marketplace.yml)

Canonical distribution catalog for Hermes Labs agent plugins. Product
implementations, MCP servers, skills, hooks, and release workflows remain in
their product repositories. This repository owns only:

- `catalog.json`, the single reviewed build input;
- `scripts/generate.mjs`, which deterministically emits native host manifests;
- `scripts/verify.mjs`, which checks identifiers, host claims, immutable pins,
  generated output, and optionally the pinned upstream manifests.

## Generated manifests

| Host | Manifest | Marketplace name |
|---|---|---|
| Claude Code | `.claude-plugin/marketplace.json` | `hermes-labs` |
| Codex | `.agents/plugins/marketplace.json` | `hermes-labs` |
| GitHub Copilot CLI | `.github/plugin/marketplace.json` | `hermes-labs-copilot` |

The names are intentionally stable. Existing installs keep their current
plugin namespace while the repository moves from `claude-plugins` to
`plugins`. GitHub redirects the former repository URL after the rename.

## Install

Claude Code:

```text
/plugin marketplace add hermes-labs-ai/plugins
/plugin install hermes-blind@hermes-labs
```

Codex:

```bash
codex plugin marketplace add hermes-labs-ai/plugins
codex plugin add hermes-blind@hermes-labs
```

GitHub Copilot CLI:

```bash
copilot plugin marketplace add hermes-labs-ai/plugins
copilot plugin install hermes-blind@hermes-labs-copilot
```

The historical `hermes-labs-ai/copilot-plugins` route remains a compatibility
feed. Its entries are generated from this catalog rather than maintained as a
second source of truth.

## Capability language

The catalog records capability type and compatibility separately:

- `skill` means an on-demand workflow is available to a host.
- `mcp` means an MCP server connection is packaged.
- `hook` means a host event interceptor exists.
- `verified` means the capability has host-specific evidence.
- `listed-unverified` preserves an existing install route without claiming a
  completed runtime certification.
- `unsupported` keeps the entry out of that host manifest.

A loaded skill does not prove that an MCP server connected. A connected MCP
server does not prove that a hook intercepted an event. An input-screening
hook does not block arbitrary output tool execution.

## Build and verify

Node.js 20 or newer is sufficient; there are no package dependencies.

```bash
npm run generate
npm test
npm run verify
npm run verify:network
claude plugin validate .claude-plugin/marketplace.json --strict
```

`verify:network` fetches every upstream plugin manifest at the exact 40-byte
commit recorded in `catalog.json` and checks its name and version. The normal
verifier is offline and fails if generated files drift from the catalog.

## Adding or updating an entry

1. Complete and review the product change in its product repository.
2. Record the immutable commit, released version, plugin root, capabilities,
   and host-specific compatibility in `catalog.json`.
3. Run `npm run generate`.
4. Run the checks above.
5. Commit `catalog.json` and all three generated manifests together.

Never copy product implementation into this repository, replace a commit pin
with a moving branch-only reference, or mark a host `verified` based only on
manifest parsing.
