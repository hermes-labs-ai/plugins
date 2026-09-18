// Regression coverage for the catalog manifest.
//
// Guards the failure this repo actually hit: a cross-repo entry written as
// {"source":"github","repo":...}. Claude Code resolves that form over
// git@github.com with no HTTPS fallback, so on any machine without an SSH key
// for the org the install aborts and no plugin lands. Every entry here must
// use an explicit HTTPS git source. Use git-subdir for subdirectories and url
// for repo-root plugins whose nested components must all be included.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifestPath = fileURLToPath(
  new URL('../.claude-plugin/marketplace.json', import.meta.url),
);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const readme = readFileSync(
  fileURLToPath(new URL('../README.md', import.meta.url)),
  'utf8',
);

const SSH_URL = /^(git@|ssh:\/\/|git:\/\/)/;

test('manifest declares plugins', () => {
  assert.ok(Array.isArray(manifest.plugins));
  assert.ok(manifest.plugins.length > 0);
});

for (const plugin of manifest.plugins) {
  test(`${plugin.name}: source avoids an SSH-based root source`, () => {
    assert.ok(
      ['git-subdir', 'url'].includes(plugin.source.source),
      `"${plugin.source.source}" is not an accepted HTTPS git source`,
    );
    assert.ok(
      !('repo' in plugin.source),
      'a bare "repo" key is the root-source form that clones over SSH',
    );
  });

  test(`${plugin.name}: url is HTTPS and the entry is fully pinned`, () => {
    const { url, ref } = plugin.source;
    assert.ok(!SSH_URL.test(url), `${url} is an SSH url`);
    assert.match(url, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/);
    assert.ok(typeof ref === 'string' && ref.length > 0);
    if (plugin.source.source === 'git-subdir') {
      assert.ok(
        typeof plugin.source.path === 'string' && plugin.source.path.length > 0,
      );
    } else {
      assert.equal(plugin.source.source, 'url');
      assert.ok(!('path' in plugin.source));
    }
  });
}

test('hermes-blind points at the cross-repo package', () => {
  const entry = manifest.plugins.find((p) => p.name === 'hermes-blind');
  assert.ok(entry, 'hermes-blind is missing from the catalog');
  assert.deepEqual(entry.source, {
    source: 'git-subdir',
    url: 'https://github.com/hermes-labs-ai/hermes-blind.git',
    path: 'claude-plugin',
    ref: 'main',
  });
  assert.equal(entry.version, '0.3.0');
});

test('agent-kickstart uses a full HTTPS git source for its repo-root plugin', () => {
  const entry = manifest.plugins.find((p) => p.name === 'agent-kickstart');
  assert.ok(entry, 'agent-kickstart is missing from the catalog');
  assert.deepEqual(entry.source, {
    source: 'url',
    url: 'https://github.com/hermes-labs-ai/agent-kickstart.git',
    ref: 'main',
  });
  assert.equal(entry.version, '0.3.0');
});

test('recent upstream plugin releases are represented in the marketplace', () => {
  const expectedVersions = {
    'little-canary': '0.3.7',
    'claude-trash-guard': '0.1.3',
    'agent-signage': '0.2.1',
    'hermes-jailbench': '0.2.1',
  };

  for (const [name, version] of Object.entries(expectedVersions)) {
    const entry = manifest.plugins.find((plugin) => plugin.name === name);
    assert.ok(entry, `${name} is missing from the catalog`);
    assert.equal(entry.version, version);
    assert.match(
      readme,
      new RegExp('^\\| `' + name + '` \\| ' + version + ' \\|', 'm'),
      `${name}'s README row does not match its marketplace version`,
    );
  }
});

// --- Path integrity: does `path` actually point at a plugin? ---------------
//
// The shape checks above pass as long as `path` is a non-empty string. They
// never check that a `.claude-plugin/plugin.json` manifest actually lives at
// that path in the target repo/ref. That gap is not hypothetical: the
// `rule-audit` entry shipped with `path: "integrations/claude-code"` while
// its manifest lives at the repo root — CI stayed green and the install was
// broken. This block closes that gap with a live check.
//
// This requires one network call per entry, which the rest of this suite
// deliberately avoids (it is offline and fast). A flaky or unreachable
// network must never fail the build — fork PRs run with no credentials and
// may have restricted egress, and a transient GitHub hiccup is not evidence
// of a broken catalog entry. So a fetch failure, a timeout, or any non-200
// response OTHER than 404 is treated as "we could not check" and the test is
// skipped rather than failed. Only a 404 — GitHub definitively answering
// that the file does not exist at that path/ref — fails the test, because
// that is the one response that actually proves the manifest is absent.

const GITHUB_HTTPS_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\.git$/;
const FETCH_TIMEOUT_MS = 8000;

// Joins an entry's `path` onto `.claude-plugin/plugin.json`, handling the
// `"."` (repo-root plugin), missing-path (a `url` source installs from the
// repo root, so `path` is absent) and trailing-slash cases without ever
// producing `./.claude-plugin/...` or a `//` in the result.
function manifestRelativePath(entryPath = '.') {
  const normalized = entryPath.replace(/^\.\/?$/, '').replace(/\/+$/, '');
  return normalized
    ? `${normalized}/.claude-plugin/plugin.json`
    : '.claude-plugin/plugin.json';
}

// Builds the raw.githubusercontent.com URL for an entry's manifest, or null
// if the entry's url does not match the HTTPS github.com form the other
// tests in this file already require.
function rawManifestUrl(source) {
  const match = GITHUB_HTTPS_URL.exec(source.url);
  if (!match) return null;
  const [, owner, repo] = match;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${source.ref}/${manifestRelativePath(source.path)}`;
}

for (const plugin of manifest.plugins) {
  test(`${plugin.name}: path resolves to an actual plugin manifest (network-checked, soft-fails offline)`, async (t) => {
    const rawUrl = rawManifestUrl(plugin.source);
    if (!rawUrl) {
      t.skip(`could not derive a raw content URL from "${plugin.source.url}"`);
      return;
    }

    let response;
    try {
      response = await fetch(rawUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      // No network, DNS failure, timeout, proxy block, etc. We could not
      // check — that is not evidence of a broken entry, so do not fail.
      t.skip(`fetch failed, cannot verify path integrity from here: ${err.message}`);
      return;
    }

    if (response.status === 404) {
      // Definitive: GitHub successfully answered that this file is absent.
      assert.fail(
        `${manifestRelativePath(plugin.source.path)} does not exist in ` +
          `${plugin.source.url} at ref "${plugin.source.ref}" (404 from ${rawUrl}). ` +
          `"path" for "${plugin.name}" does not point at a plugin.`,
      );
      return;
    }

    if (!response.ok) {
      // Rate limited, transient 5xx, etc. — inconclusive, not a failure.
      t.skip(`non-200, non-404 response (${response.status}) from ${rawUrl}; cannot verify`);
      return;
    }

    // 200: fetched successfully. Confirm it is at least parseable JSON, the
    // one further check that costs nothing given we already fetched it.
    const body = await response.text();
    assert.doesNotThrow(
      () => JSON.parse(body),
      `${rawUrl} responded 200 but body is not valid JSON`,
    );
  });
}
