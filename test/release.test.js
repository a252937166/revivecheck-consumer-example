// The business output: a versioned token-catalog release built from this consumer's own
// decision, read back by a separate process, and the release gate command on this
// repository's configuration and fixtures. Offline; the browser page uses these same
// library functions (`revivecheck/catalog-release`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalogRelease, verifyCatalogRelease, readCatalogRelease, compareCatalogReleases, selectorFrom, EXIT } from 'revivecheck/catalog-release';
import { reconstructDecision } from 'revivecheck/decision';
import { loadConfig, runFixture, decide } from '../src/evaluate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const config = loadConfig(readJson('config/allowlist.json'));
const fixtures = Object.fromEntries(['valid-r2', 'revoked-r2', 'unavailable'].map((name) => [name, readJson(`fixtures/${name}.json`)]));
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
const gate = path.join(root, 'node_modules', '.bin', 'revivecheck-catalog');
const PRODUCER = { name: config.name, kind: 'consumer', control: config.roles.operator.control, interface: 'test' };

/** The decision pieces the page hands to buildCatalogRelease. */
function decision(fixture, entry = config.entry, now) {
  const run = runFixture(config, fixture, { now });
  const result = decide(config, run, { entry });
  return { run, result, pieces: { policy: config.policy, binding: run.binding, report: run.report, evaluation: result.evaluation, inputs: run.inputs, configuredEntry: entry } };
}

test('the eligible entry becomes a release with every field from the approved report; a wrong entry, a revoked approval or expired evidence releases nothing', () => {
  const valid = decision(fixtures['valid-r2']);
  const release = buildCatalogRelease({ name: config.name, producer: PRODUCER, decisions: [valid.pieces], generatedAt: valid.run.now.toISOString() });
  assert.equal(release.version, 1);
  assert.equal(release.entries.length, 1);
  assert.deepEqual([release.entries[0].symbol, release.entries[0].decimals, release.entries[0].assetId, release.entries[0].revision], ['pUSD', 6, '7777', '2']);
  assert.equal(release.entries[0].validUntil, plus(valid.run.inputs.observation.observedAt, 900_000));
  assert.equal(verifyCatalogRelease(release).ok, true);
  assert.equal(reconstructDecision(release.evidence[0]).ok, true);
  const read = readCatalogRelease(release, { now: valid.run.now });
  assert.equal(read.ok, true);
  assert.equal(selectorFrom(read)[0].selectable, true);
  assert.equal(readCatalogRelease(release, { now: plus(release.validity.validUntil, 1) }).ok, false, 'lapsed one millisecond after the deadline');
  for (const [name, pieces] of [['wrong decimals', decision(fixtures['valid-r2'], { ...config.entry, decimals: 18 }).pieces], ['revoked', decision(fixtures['revoked-r2']).pieces], ['expired', decision(fixtures['valid-r2'], config.entry, '2026-11-02T09:43:18.329Z').pieces], ['unavailable', decision(fixtures.unavailable).pieces]]) {
    const refused = buildCatalogRelease({ name: config.name, producer: PRODUCER, decisions: [pieces], generatedAt: pieces.evaluation.evaluatedAt });
    assert.equal(refused.entries.length, 0, name);
    assert.ok(refused.withheld[0].reasons.length > 0, name);
    assert.ok(refused.withheld[0].diagnostics.every((item) => item.pointer && item.role && item.nextAction), `${name}: diagnostics name the pointer, the role and the next action`);
    assert.equal(readCatalogRelease(refused, { now: pieces.evaluation.evaluatedAt }).ok, false, name);
  }
  // A second release chains to the first; the comparison names the change.
  const revoked = decision(fixtures['revoked-r2']);
  const second = buildCatalogRelease({ name: config.name, producer: PRODUCER, decisions: [revoked.pieces], previous: release, generatedAt: revoked.run.now.toISOString() });
  assert.equal(second.version, 2);
  assert.equal(second.previousReleaseHash, release.releaseHash);
  const diff = compareCatalogReleases(release, second);
  assert.equal(diff.chained, true);
  assert.equal(diff.summary.removed, 1);
  assert.ok(diff.removed[0].withheldAfter.reasons.includes('approval-revoked'));
  // Fresh reads showing the revocation withhold an entry that is still within its deadline.
  const at = plus(valid.run.inputs.observation.observedAt, 30_000);
  const redate = (inputs) => ({ ...inputs, observation: { ...inputs.observation, observedAt: at }, registry: { ...inputs.registry, observedAt: at }, listing: { ...inputs.listing, observedAt: at } });
  assert.equal(readCatalogRelease(release, { now: at, reads: { [config.entry.address]: redate(valid.run.inputs) } }).ok, true);
  const revokedNow = readCatalogRelease(release, { now: at, reads: { [config.entry.address]: redate(revoked.run.inputs) } });
  assert.equal(revokedNow.ok, false);
  assert.ok(revokedNow.withheld[0].reasons.includes('approval-revoked'));
});

test('the release gate command on this configuration: permitted writes the release, refused and unknown do not, with distinct exit codes', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'consumer-release-'));
  const run = (...args) => spawnSync(gate, args, { cwd: root, encoding: 'utf8' });
  const permitted = run('prepare', '--config', 'config/allowlist.json', '--fixture', 'fixtures/valid-r2.json', '--out', path.join(out, 'ok'));
  assert.equal(permitted.status, EXIT.permitted, permitted.stdout + permitted.stderr);
  const release = JSON.parse(readFileSync(path.join(out, 'ok/catalog-release-1.json'), 'utf8'));
  assert.equal(verifyCatalogRelease(release).ok, true);
  assert.equal(JSON.parse(readFileSync(path.join(out, 'ok/outcome.json'), 'utf8')).status, 'permitted');
  const read = run('read', path.join(out, 'ok/catalog-release-1.json'), '--now', release.generatedAt, '--json');
  assert.equal(read.status, 0, read.stdout + read.stderr);
  assert.equal(JSON.parse(read.stdout).usable.length, 1);
  const revoked = run('prepare', '--config', 'config/allowlist.json', '--fixture', 'fixtures/revoked-r2.json', '--out', path.join(out, 'revoked'));
  assert.equal(revoked.status, EXIT.refused);
  assert.equal(existsSync(path.join(out, 'revoked/catalog-release-1.json')), false);
  const revokedOutcome = JSON.parse(readFileSync(path.join(out, 'revoked/outcome.json'), 'utf8'));
  assert.ok(revokedOutcome.reasons.includes('approval-revoked'));
  assert.equal(revokedOutcome.diagnostics.find((item) => item.code === 'approval-revoked').role, 'reviewer');
  const unknown = run('prepare', '--config', 'config/allowlist.json', '--fixture', 'fixtures/unavailable.json', '--out', path.join(out, 'unavailable'));
  assert.equal(unknown.status, EXIT.unknown, unknown.stdout + unknown.stderr);
  assert.equal(JSON.parse(readFileSync(path.join(out, 'unavailable/outcome.json'), 'utf8')).status, 'unknown');
  const wrong = run('prepare', '--config', 'fixtures/config-wrong-decimals.json', '--fixture', 'fixtures/valid-r2.json', '--out', path.join(out, 'wrong'));
  assert.equal(wrong.status, EXIT.refused);
  assert.deepEqual(JSON.parse(readFileSync(path.join(out, 'wrong/outcome.json'), 'utf8')).reasons, ['entry-mismatch:decimals']);
  const bad = path.join(out, 'bad.json');
  writeFileSync(bad, JSON.stringify({ ...readJson('config/allowlist.json'), release: { ...config.release, storage: null } }));
  const badRun = run('prepare', '--config', bad, '--fixture', 'fixtures/valid-r2.json', '--out', path.join(out, 'bad'));
  assert.equal(badRun.status, EXIT['configuration-error']);
  assert.match(badRun.stderr, /requires stored evidence/);
});
