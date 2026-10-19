# Use Hermes tools in Antigravity

Run CSV validation, code-quality gates, research, and memory tools from Antigravity using existing Hermes packages. Start with a portable skill or bring across an installed Gemini CLI extension.

## Start with CSV Quality Gate

Use this pinned package to check CSV files for missing columns, empty cells, and other preflight issues. You need [Antigravity CLI](https://antigravity.google/docs/cli/install/), Git, and `uv` (or an existing CSV Quality Gate installation).

```bash
git clone https://github.com/hermes-labs-ai/csv-quality-gate.git
git -C csv-quality-gate checkout --detach 0a5faeb38de43b53dc813bf8eced2cb765e2c620
agy plugin validate ./csv-quality-gate
agy plugin install ./csv-quality-gate
agy plugin list
```

Start Antigravity in your data project and ask it to use `csv-quality-gate` on a named CSV file. The skill uses the published `csv-quality-gate==0.3.1` runner when the CLI is not already installed. It returns pass, warn, or fail with line-number evidence.

This exact source passed native install, list, and validation with Antigravity CLI 1.2.11 in a clean environment; the installed skill matched the source byte for byte. The underlying CLI also passed separate clean/failing CSV checks. Agent-driven execution was not part of those checks. The [machine-readable results](../evidence/antigravity-import-1.2.11.json) record the source pins and test scope.

Antigravity installs a copy of the plugin. To update later, check out the desired reviewed source and reinstall. To stop using it, run `agy plugin disable csv-quality-gate`; to remove the installed copy, run `agy plugin uninstall csv-quality-gate`.

## Migrate installed Gemini CLI extensions

Google's importer converts **all locally installed Gemini CLI extensions** in one operation, including hook-based packages. Review the tool table before running it. For CSV Quality Gate alone, use the direct local install shown above instead of the bulk importer:

```bash
agy plugin import gemini
agy plugin list
```

The command imports locally installed Gemini extensions. It converts legacy commands and MCP definitions into Antigravity's layout. Read the per-package output and confirm the expected entries in `plugin list`: version 1.2.11 returned exit code 0 even when one package failed to import. Use `agy help plugin` for command help; do not append `--help` to an import command.

The same test imported 12 of the 13 Hermes packages below. Rule Audit hit the manifest issue shown in the table. The four hook packages retained their Gemini event names, so their automatic behavior needs an Antigravity adapter before use. Fidelis' MCP definition was generated, but connecting the server requires its runtime and configuration.

## Choose a tool

A skill runs when requested; an automatic hook needs its own Antigravity event adapter. Importing a directory does not turn a Gemini hook into an Antigravity hook.

| Tool | Tested manifest version | Existing Gemini components | Antigravity route |
| --- | --- | --- | --- |
| [CSV Quality Gate](https://github.com/hermes-labs-ai/csv-quality-gate) | 0.3.1 | CSV validation skill | Reuse the portable skill package. |
| [Quick Gate Python](https://github.com/hermes-labs-ai/quick-gate-python) | 0.3.2 | Python quality-gate skill | Reuse the portable skill package. |
| [Quick Gate JS](https://github.com/hermes-labs-ai/quick-gate-js) | 0.3.2 | JavaScript / TypeScript quality-gate skill | Reuse the portable skill package. |
| [SuperSearch](https://github.com/hermes-labs-ai/supersearch) | 0.11.0 | Research skill | Reuse the portable skill package; public search requires network access. |
| [Hermes JailBench](https://github.com/hermes-labs-ai/hermes-jailbench) | 0.2.2 | Evaluation skill | Reuse the portable skill package. |
| [Intent Verify](https://github.com/hermes-labs-ai/intent-verify) | 0.2.1 | Skill and check/map commands | Import commands as skills. |
| [Rule Audit](https://github.com/hermes-labs-ai/rule-audit) | 0.5.0 | Skill and audit command | The Gemini manifest uses an array for `contextFileName`; Antigravity CLI 1.2.11 rejects that manifest during import. Preserve the complete skill folder, including `scripts/codex_audit.py`, when installing it as an Agent Skill. |
| [Fidelis](https://github.com/hermes-labs-ai/fidelis) | 0.3.0rc1 | MCP server and context | Migrate the MCP connection; confirm server startup and context separately. |
| [LintLang](https://github.com/hermes-labs-ai/lintlang) | 0.8.0 | Audit skill and post-edit hook | Reuse the audit skill; automatic post-edit checks need an Antigravity adapter. |
| [Little Canary](https://github.com/hermes-labs-ai/little-canary) | 0.3.10 | Prompt-screening hook | Needs an Antigravity adapter before use as an automatic guardrail. |
| [Agent Trash Guard](https://github.com/hermes-labs-ai/agent-trash-guard) | 0.1.3 | Deletion skill and pre-tool hook | Reuse the skill only after checking host-specific instructions; automatic interception needs an Antigravity adapter. |
| [Hermeneutic](https://github.com/hermes-labs-ai/hermeneutic) | 0.1.12 | Skill and post-agent hook | The automatic gate needs an Antigravity adapter. |
| [Hermes Blind](https://github.com/hermes-labs-ai/hermes-blind) | 0.3.2 | Session-recovery skill | Its session readers target Claude Code and Codex logs; importing the skill does not add an Antigravity session reader. |

The version column describes the tested source snapshot, not a promise that every component has run in Antigravity. Full commit pins are in the results linked above. Existing product prerequisites still apply: Quick Gate Python needs the project's Ruff/Pyright/test tools, Quick Gate JS needs Node and the project's dependencies, SuperSearch needs network access, and live Jailbench evaluations need an authorized model endpoint.

## Bring across your configuration

Google documents these changes:

- Project skills move from `.gemini/skills/` to `.agents/skills/`. Preserve the original directory if you still use Gemini CLI.
- MCP servers move from Gemini's `settings.json` to a dedicated `mcp_config.json`. Remote `url` / `httpUrl` keys become `serverUrl`; verify required environment variables and credentials separately.
- `GEMINI.md` and `AGENTS.md` remain recognized context files. Check any extension-specific context in the converted package.
- CLI and desktop installations use different global paths. Follow the installation instructions for the Antigravity surface you use.

For hook-based tools, keep the original Gemini installation available until the Antigravity behavior has been tested. Gemini events such as `BeforeAgent`, `BeforeTool`, `AfterTool`, and `AfterAgent` cannot be treated as equivalent to Antigravity events by renaming the manifest. Input fields, tool names, event timing, outputs, and timeout units also matter.

## Fidelis: connect the existing MCP server

MCP means Model Context Protocol: Antigravity launches a small process that exposes Fidelis's memory tools. There is no separate Antigravity memory backend to deploy.

The imported definition runs:

```bash
uvx --from fidelis-memory==0.3.0rc1 fidelis mcp serve
```

`uvx` is included with [uv](https://docs.astral.sh/uv/). It must be visible on the PATH inherited by Antigravity; use its absolute executable path if your desktop session does not inherit your shell PATH.

The bridge also needs the existing local Fidelis service. Retrieval and ingestion require Ollama with `nomic-embed-text` available. On a fresh macOS or Linux installation, follow [Fidelis setup](https://github.com/hermes-labs-ai/fidelis#try-it-with-one-note); keep an existing service and memory store in place when adding another client. The default service port is `19420`; if you use a different port, set `FIDELIS_PORT` consistently for the service and its MCP client.

In Antigravity's `mcp_config.json`, merge this entry into the existing `mcpServers` object; preserve other servers. If the Gemini import already created a `fidelis` entry, use that entry rather than registering it again.

```json
{
  "mcpServers": {
    "fidelis": {
      "command": "uvx",
      "args": ["--from", "fidelis-memory==0.3.0rc1", "fidelis", "mcp", "serve"]
    }
  }
}
```

Restart or reload the client, confirm the six Fidelis tools are listed, and call `fidelis_health`. This verifies the connection without storing a memory. A healthy service and available embeddings are separate from having notes to retrieve; use your existing store or deliberately ingest the notes you want available.

See [Fidelis's technical reference](https://github.com/hermes-labs-ai/fidelis/blob/main/docs/full-reference.md) for service setup and supported platforms.

## Google references

- [Migrate Gemini CLI extensions](https://antigravity.google/docs/cli/gcli-migration/)
- [Install and manage Antigravity plugins](https://antigravity.google/docs/plugins?tab=cli)
- [Antigravity skills](https://antigravity.google/docs/skills/)
- [Antigravity hooks](https://antigravity.google/docs/hooks/)
- [MCP connections](https://antigravity.google/docs/mcp/)

[Gemini CLI remains available for supported enterprise and paid API use](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/). This guide adds an Antigravity path alongside existing host integrations.
