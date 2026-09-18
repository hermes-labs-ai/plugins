#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  externalSource,
  pluginsFor,
  readCatalog,
  root,
  titleCategory,
  writeGenerated,
  writeJsonFile,
} from './catalog-lib.mjs';

const catalog = await readCatalog();
const { owner, namespaces } = catalog.catalog;
const compatOutputIndex = process.argv.indexOf('--compat-output');
const compatOutput = compatOutputIndex === -1 ? null : process.argv[compatOutputIndex + 1];
const onlyCompat = process.argv.includes('--only-compat');

if (compatOutputIndex !== -1 && !compatOutput) {
  throw new Error('--compat-output requires a path');
}

const claude = {
  $schema: 'https://json.schemastore.org/claude-code-marketplace.json',
  name: namespaces.claude,
  description: catalog.catalog.description,
  owner,
  plugins: pluginsFor(catalog, 'claude').map((plugin) => ({
    name: plugin.id,
    description: plugin.description,
    version: plugin.version,
    category: plugin.category,
    source: externalSource(plugin, 'claude'),
    ...(plugin.homepage ? { homepage: plugin.homepage } : {}),
  })),
};

const codex = {
  name: namespaces.codex,
  interface: {
    displayName: catalog.catalog.displayName,
  },
  plugins: pluginsFor(catalog, 'codex').map((plugin) => ({
    name: plugin.id,
    source: externalSource(plugin, 'codex'),
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL',
    },
    category: titleCategory(plugin.category),
    description: plugin.description,
    version: plugin.version,
    repository: plugin.repository,
    ...(plugin.homepage ? { homepage: plugin.homepage } : {}),
  })),
};

const copilot = {
  name: namespaces.copilot,
  owner,
  metadata: {
    description: catalog.catalog.description,
    version: catalog.catalog.version,
  },
  plugins: pluginsFor(catalog, 'copilot').map((plugin) => ({
    name: plugin.id,
    description: plugin.description,
    version: plugin.version,
    source: externalSource(plugin, 'copilot'),
    category: plugin.category,
    repository: plugin.repository,
    ...(plugin.homepage ? { homepage: plugin.homepage } : {}),
  })),
};

const copilotCompatibility = {
  ...copilot,
  plugins: pluginsFor(catalog, 'copilot').map((plugin) => ({
    name: plugin.id,
    description: plugin.description,
    version: plugin.version,
    source: externalSource(plugin, 'claude'),
    category: plugin.category,
    repository: plugin.repository,
    ...(plugin.homepage ? { homepage: plugin.homepage } : {}),
  })),
};

if (!onlyCompat) {
  await Promise.all([
    mkdir(resolve(root, '.claude-plugin'), { recursive: true }),
    mkdir(resolve(root, '.agents/plugins'), { recursive: true }),
    mkdir(resolve(root, '.github/plugin'), { recursive: true }),
  ]);

  await Promise.all([
    writeGenerated('.claude-plugin/marketplace.json', claude),
    writeGenerated('.agents/plugins/marketplace.json', codex),
    writeGenerated('.github/plugin/marketplace.json', copilot),
  ]);
}

if (compatOutput) {
  await mkdir(resolve(compatOutput, '..'), { recursive: true });
  await writeJsonFile(compatOutput, copilotCompatibility);
}
