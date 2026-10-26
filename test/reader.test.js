// Repair handoff 2026-10-26, R-06: the loaded-release reader decides from the document and
// the clock it is handed, on the installed package's deadline semantics (inclusive at
// validUntil, unavailable one millisecond later), and never from a cached decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadedReleaseView, verifiedOnce } from '../src/reader.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = JSON.parse(readFileSync(path.join(root, 'out/releases/catalog-release-1.json'), 'utf8'));
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
const DEADLINE = release.validity.validUntil;

test('R06-A, R06-B: the retained release is usable before its deadline, at the deadline, and unavailable one millisecond after it, from the same document', () => {
  assert.equal(DEADLINE, '2026-10-25T19:05:17.293Z', 'the retained live release of 2026-10-25');
  const before = loadedReleaseView(release, release.generatedAt);
  assert.equal(before.read.ok, true);
  assert.equal(before.verdict, 'At least one entry may be used now');
  assert.equal(before.rows[0].selectable, true);
  assert.equal(before.nextDeadline, DEADLINE, 'the page wakes at the release\'s own deadline');
  assert.match(before.clockNote, /the chain was not read/);
  const boundary = loadedReleaseView(release, DEADLINE);
  assert.equal(boundary.read.ok, true, 'inclusive at validUntil');
  const after = loadedReleaseView(release, plus(DEADLINE, 1));
  assert.equal(after.read.ok, false, 'one millisecond later nothing is usable');
  assert.equal(after.verdict, 'Nothing in this file may be used now');
  assert.deepEqual(after.rows.map((row) => row.selectable), [false]);
  assert.deepEqual(after.read.withheld[0].reasons, ['lapsed']);
  assert.equal(after.nextDeadline, null);
  assert.equal(after.read.freshness, 'deadline-only', 'a clock update is not a chain read, and the view says so');
  assert.equal(verifiedOnce(release), verifiedOnce(release), 'verification is cached per document');
  assert.equal(verifiedOnce(release).ok, true);
});

test('R06-D, R06-F: expired, malformed or hash-invalid documents grant nothing; a replaced document replaces the decision', () => {
  const tampered = { ...release, entries: [{ ...release.entries[0], decimals: 18 }] };
  const view = loadedReleaseView(tampered, release.generatedAt);
  assert.equal(view.read.ok, false);
  assert.deepEqual(view.read.withheld[0].reasons, ['release-unverified']);
  assert.equal(view.verification.ok, false);
  assert.equal(loadedReleaseView({ schema: 'other' }, release.generatedAt).read.ok, false);
  assert.equal(loadedReleaseView(null, release.generatedAt).read.ok, false);
  assert.equal(loadedReleaseView(release, plus(DEADLINE, 86_400_000)).read.ok, false, 'reloading an expired document grants nothing');
  // Another document, another decision, immediately.
  const other = { ...release, generatedAt: plus(release.generatedAt, 1000) };
  assert.equal(loadedReleaseView(other, release.generatedAt).read.ok, false, 'a document edited after generation does not verify');
});
