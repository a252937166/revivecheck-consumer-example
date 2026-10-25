#!/usr/bin/env node
// Write the hosting manifest of a built Token eligibility demo: one JSON file beside
// the served files that names the source commit, the repository, the build time and
// every served file with its SHA-256. It is generated AFTER the build and never part
// of the source; `node scripts/verify-hosting.mjs` in the ReviveCheck repository (or
// any reader) fetches `/hosting.json`, parses it and compares the served index with it.
//
//   node scripts/hosting-manifest.mjs --dist dist-web --commit <sha> --repository <owner/name> [--site <url>] [--release <id>]
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

export const HOSTING_SCHEMA = 'revivecheck-consumer.hosting-manifest.v1';
const exec = promisify(execFile);
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full, base));
    else if (!entry.name.startsWith('._') && entry.name !== '.DS_Store' && path.relative(base, full) !== 'hosting.json') out.push(path.relative(base, full));
  }
  return out.sort();
}

export async function buildHostingManifest({ dist, commit, repository, site = null, release = null, run = null, builtAt = new Date().toISOString() }) {
  if (!/^[0-9a-f]{40}$/.test(commit || '')) throw new Error('--commit is the full 40-hex source commit.');
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repository || '')) throw new Error('--repository is owner/name.');
  const files = [];
  for (const relative of await listFiles(dist)) { const buffer = await readFile(path.join(dist, relative)); files.push({ path: relative, bytes: buffer.length, sha256: sha256(buffer) }); }
  if (!files.some((file) => file.path === 'index.html')) throw new Error(`${dist} has no index.html.`);
  return { schema: HOSTING_SCHEMA, sourceCommit: commit, sourceUrl: `https://github.com/${repository}/commit/${commit}`, repository, ...(site ? { site } : {}), ...(release ? { release } : {}), ...(run ? { run } : {}), builtAt, files, note: 'Describes the hosted build only; the decision the page makes is evaluated live in the browser and is not stated here.' };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const option = (name, fallback = null) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
  const dist = option('--dist', 'dist-web');
  const commit = option('--commit') || (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim();
  const manifest = await buildHostingManifest({ dist, commit, repository: option('--repository', process.env.GITHUB_REPOSITORY || 'a252937166/revivecheck-consumer-example'), site: option('--site'), release: option('--release'), run: option('--run', process.env.GITHUB_RUN_ID || null) });
  await writeFile(path.join(dist, 'hosting.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${path.join(dist, 'hosting.json')}: ${manifest.files.length} files for commit ${commit}`);
}
