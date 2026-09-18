import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const catalogPath = resolve(root, 'catalog.json');

export async function readCatalog() {
  return JSON.parse(await readFile(catalogPath, 'utf8'));
}

export function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function gitUrl(repository) {
  return `${repository}.git`;
}

export function externalSource(plugin, host) {
  const common = {
    url: gitUrl(plugin.repository),
    ref: plugin.source.ref,
    sha: plugin.source.commit,
  };

  if (plugin.source.path === '.') {
    return { source: 'url', ...common };
  }

  if (host === 'copilot') {
    return { source: 'url', ...common, path: plugin.source.path };
  }

  return {
    source: 'git-subdir',
    ...common,
    path: plugin.source.path,
  };
}

export function pluginsFor(catalog, host) {
  return catalog.plugins.filter((plugin) => plugin.targets.includes(host));
}

export function titleCategory(category) {
  return category
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

export async function writeGenerated(relativePath, value) {
  await writeFile(resolve(root, relativePath), json(value));
}

export async function writeJsonFile(path, value) {
  await writeFile(resolve(path), json(value));
}
