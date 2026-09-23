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
- `verified` means the capability has host-specific evidence. For Claude that
  evidence is a pilot-proof receipt for the exact pinned commit, enforced by
  `verify`. For Codex it rests on earlier manual checks, because no receipt can
  exist yet; see Runtime certification below.
- `listed-unverified` preserves an existing install route without claiming a
  completed runtime certification.
- `unsupported` keeps the entry out of that host manifest.

When a product needs different native package roots on different hosts, the
catalog can use separate rows with the same plugin ID and disjoint targets.
LintLang keeps the `lintlang` install name while Claude Code and Copilot CLI
resolve to their respective integration directories; no product files are
copied into this catalog.

A loaded skill does not prove that an MCP server connected. A connected MCP
server does not prove that a hook intercepted an event. An input-screening
hook does not block arbitrary output tool execution.

## Runtime certification

`verify.mjs` checks identifiers, pins and generated output, none of which can
tell you what a host actually loads. The pilot proof pack supplies that half:

```bash
node scripts/pilot-proof.mjs --host claude
```

For every entry targeting the host it adds the pushed marketplace branch over
public HTTPS, verifies the cloned marketplace HEAD is the exact commit being
certified, installs the entry, reads back the component inventory the host
loaded, compares it against the declared capabilities, uninstalls, and finally
restores the marketplace and plugin list
to their pre-run state. Certification refuses to start if the `hermes-labs`
marketplace or any target plugin is already present, and it refuses to replace
the canonical receipt unless the full run passes with successful state reads,
no unresolved checks, and verified restoration. The receipt records each host
command with its exit status, so a run that failed to clean up is visible
rather than silent.

`verify` then refuses any entry marked `verified` for a **certifiable** host
unless the committed receipt has a passing result for the same commit and
version. Bumping a pin without re-certifying fails; downgrading the entry to
`listed-unverified` is the other legitimate way to clear it. The check reads
the committed receipt, so it still runs in CI, where no agent host CLI is
installed.

Claude is currently the only certifiable host, and this is the honest state of
the other two:

| Host | Certifiable | What `verified` rests on today |
|---|---|---|
| Claude Code | yes | `evidence/pilot-proof-claude.json`, enforced by `verify` |
| Codex | no | earlier manual checks, not receipt-backed and not gated |
| GitHub Copilot CLI | no | no entry currently claims `verified` |

Codex and Copilot install the same pinned sources, but neither CLI exposes a
component inventory readback, so `pilot-proof.mjs` refuses those hosts rather
than certify a lifecycle and imply capability evidence. The five Codex
`verified` entries predate this pack; they are not downgraded here because that
would assert a negative the pack cannot demonstrate either. Extending coverage
means adding a host to `CERTIFIED_HOSTS` once a readback exists.

Two further limits are deliberate. `claude plugin details` reports slash
commands inside its `Skills` bucket, so `skill` and `command` are separated
from the installed plugin tree rather than from the inventory. And the pack
probes only `skill`, `mcp`, `hook` and `command`; an entry declaring a
schema-legal capability with no probe, such as `agent` or `lsp`, is failed
rather than passed by omission.

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
4. Commit and push the catalog plus generated marketplace manifests, then
   re-run `node scripts/pilot-proof.mjs --host claude` when the entry claims a
   `verified` host. The runner adds the pushed branch and refuses certification
   unless Claude's local marketplace clone resolves to that exact commit.
5. Run the checks above.
6. Commit `catalog.json`, all three generated manifests, and any updated
   receipt together.

Never copy product implementation into this repository, replace a commit pin
with a moving branch-only reference, or mark a host `verified` based only on
manifest parsing.
