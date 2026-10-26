// Repair handoff 2026-10-26, R-01: the installed package and this consumer's boundary.
// Every import here is the INSTALLED `revivecheck` dependency, never the upstream source
// tree: what is proven holds for the bytes this consumer ships with. The fresh-subject
// fixtures are the captured revision-2 reads plus a synthetic, labelled subject read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePolicy, policyHash } from 'revivecheck/policy';
import { decisionValidity } from 'revivecheck/current';
import { reconstructDecision } from 'revivecheck/decision';
import { loadConsumerConfig } from 'revivecheck/catalog-release';
import { loadConfig, assertRequirementsRetained, readsFor, runFixture, decide } from '../src/evaluate.js';
import { decisionEvidenceFor } from '../src/decision-evidence.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const legacy = readJson('config/allowlist.json');
const fresh = readJson('fixtures/config-fresh-subject.json');
const fixtures = { unchanged: readJson('fixtures/fresh-subject-r2.json'), changed: readJson('fixtures/fresh-subject-changed-r2.json'), legacy: readJson('fixtures/valid-r2.json') };
// Recorded by the corrected upstream source on 2026-10-26 for this consumer's policy with requireFreshSubject: true; the installed package must agree without importing that source.
const LEGACY_HASH = '795942d67b86c2c9b35c07fe3e24f2d8796dbd01ea79806b35cf125aaf44f8c3';
const FRESH_HASH = readJson('fixtures/fresh-subject-policy-hash.json').policyHash;
const gate = path.join(root, 'node_modules', '.bin', 'revivecheck-catalog');
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
/** The 0.5.0 behavior, simulated over the installed normalizer: the option is dropped and the legacy fingerprint results. */
const olderNormalizer = (policy) => { const normalized = normalizePolicy(policy); const { requireFreshSubject, ...evidence } = normalized.evidence; return { ...normalized, evidence }; };

test('R01-A, R01-B: the installed package retains the fresh-subject requirement with the recorded fingerprint; absent and explicit-false keep the legacy fingerprint; the guard refuses an implementation that drops it', () => {
  assert.equal(policyHash(legacy.policy), LEGACY_HASH);
  assert.equal(policyHash({ ...legacy.policy, evidence: { ...legacy.policy.evidence, requireFreshSubject: false } }), LEGACY_HASH);
  assert.equal(normalizePolicy(fresh.policy).evidence.requireFreshSubject, true, 'the installed normalizer retains the option');
  assert.equal(policyHash(fresh.policy), FRESH_HASH, 'the same fingerprint the corrected source computes');
  assert.notEqual(FRESH_HASH, LEGACY_HASH);
  assert.equal(loadConfig(fresh, 'fresh').policy.evidence.requireFreshSubject, true);
  assert.equal(loadConfig(legacy, 'legacy').schema, 'revivecheck-consumer.config.v1');
  assert.equal(loadConfig(legacy, 'legacy', { normalize: olderNormalizer }).schema, 'revivecheck-consumer.config.v1', 'a legacy configuration passes an older implementation');
  assert.throws(() => loadConfig(fresh, 'fresh', { normalize: olderNormalizer }), /does not retain the requested policy requirement evidence\.requireFreshSubject/, 'the stronger configuration is refused by an implementation that would weaken it');
  assert.equal(policyHash(olderNormalizer(fresh.policy)), LEGACY_HASH, 'exactly the silent weakening the guard refuses');
  assert.throws(() => assertRequirementsRetained({ evidence: { requireFutureCapability: true } }, normalizePolicy(legacy.policy)), /evidence\.requireFutureCapability/);
  assert.throws(() => loadConsumerConfig({ ...fresh, policy: { ...fresh.policy, evidence: { ...fresh.policy.evidence, requireFutureCapability: true } } }, 'future'), /evidence\.requireFutureCapability/, 'the installed gate refuses a requirement it cannot support');
  assert.deepEqual(readsFor(legacy.policy), ['observation', 'registry', 'listing', 'evidence']);
  assert.deepEqual(readsFor(fresh.policy), ['observation', 'registry', 'listing', 'evidence', 'subject']);
});

test('R01-C, R01-D: unchanged fresh subject observations pass; missing, stale, disagreeing, wrong-target or changed ones never do; the refusal is the same in the API, this consumer and the release gate', () => {
  const unchanged = decide(fresh, runFixture(fresh, fixtures.unchanged), { entry: fresh.entry });
  assert.equal(unchanged.allowed, true, JSON.stringify(unchanged.evaluation.reasons));
  assert.deepEqual(unchanged.evaluation.checks.filter((check) => check.id.startsWith('subject.')).map((check) => check.status), ['passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed']);
  const changed = decide(fresh, runFixture(fresh, fixtures.changed), { entry: fresh.entry });
  assert.equal(changed.allowed, false);
  assert.equal(changed.evaluation.status, 'recheck-required');
  assert.deepEqual(changed.allowlist.denied[0].reasons, ['subject-changed']);
  const missing = decide(fresh, runFixture(fresh, fixtures.legacy), { entry: fresh.entry });
  assert.equal(missing.evaluation.status, 'unknown', 'no subject read under a fresh-subject policy is unknown, never valid');
  assert.deepEqual(missing.allowlist.denied[0].reasons, ['subject-unavailable']);
  const withSubject = (patch) => ({ ...fixtures.unchanged, inputs: { ...fixtures.unchanged.inputs, subject: { ...fixtures.unchanged.inputs.subject, ...patch } } });
  assert.ok(decide(fresh, runFixture(fresh, withSubject({ observedAt: plus(fixtures.unchanged.now, -901_000) })), { entry: fresh.entry }).allowlist.denied[0].reasons.includes('observation-stale'), 'stale');
  assert.ok(decide(fresh, runFixture(fresh, withSubject({ interfacesAgree: false, evm: { ...fixtures.unchanged.inputs.subject.evm, decimals: 18 } })), { entry: fresh.entry }).allowlist.denied[0].reasons.includes('interfaces-disagree'), 'disagreeing');
  assert.ok(decide(fresh, runFixture(fresh, withSubject({ subject: '0x00001e6200000000000000000000000000010000', assetId: '7778' })), { entry: fresh.entry }).allowlist.denied[0].reasons.includes('subject-domain-mismatch'), 'wrong target');
  assert.ok(decide(fresh, runFixture(fresh, withSubject({ supported: false, native: null, evm: null })), { entry: fresh.entry }).allowlist.denied[0].reasons.includes('subject-unsupported'), 'unsupported runtime');
  // The legacy policy on the same reads claims no subject check and stays valid: its narrower guarantee is unchanged.
  const legacyRun = decide(legacy, runFixture(legacy, fixtures.changed), { entry: legacy.entry });
  assert.equal(legacyRun.allowed, true);
  assert.equal(legacyRun.evaluation.checks.some((check) => check.id.startsWith('subject.')), false);
  // The release gate, from the installed command, on the same configuration and fixture: refused with the same reason.
  const out = mkdtempSync(path.join(tmpdir(), 'consumer-fresh-subject-'));
  const refused = spawnSync(gate, ['prepare', '--config', 'fixtures/config-fresh-subject.json', '--fixture', 'fixtures/fresh-subject-changed-r2.json', '--out', path.join(out, 'changed')], { cwd: root, encoding: 'utf8' });
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  const outcome = JSON.parse(readFileSync(path.join(out, 'changed/outcome.json'), 'utf8'));
  assert.deepEqual([outcome.status, outcome.reasons], ['refused', ['subject-changed']]);
  assert.equal(outcome.diagnostics[0].pointer, '/evaluation/checks/subject.metadata');
  assert.equal(outcome.diagnostics[0].checkpointKind, 'subject');
  const permitted = spawnSync(gate, ['prepare', '--config', 'fixtures/config-fresh-subject.json', '--fixture', 'fixtures/fresh-subject-r2.json', '--out', path.join(out, 'unchanged')], { cwd: root, encoding: 'utf8' });
  assert.equal(permitted.status, 0, permitted.stdout + permitted.stderr);
  const release = JSON.parse(readFileSync(path.join(out, 'unchanged/catalog-release-1.json'), 'utf8'));
  assert.equal(release.evidence[0].policy.evidence.requireFreshSubject, true);
  assert.equal(release.evidence[0].inputs.subject.native.decimals, 6, 'the subject read travels in the release evidence');
  const unknown = spawnSync(gate, ['prepare', '--config', 'fixtures/config-fresh-subject.json', '--fixture', 'fixtures/valid-r2.json', '--out', path.join(out, 'missing')], { cwd: root, encoding: 'utf8' });
  assert.equal(unknown.status, 2, 'a fresh-subject policy without a subject read is unknown at the gate too');
});

test('R01-E: the exported evidence retains the subject read, reconstructs with the installed package, and the subject observation can be the earliest permission deadline', () => {
  const run = runFixture(fresh, fixtures.unchanged);
  const result = decide(fresh, run, { entry: fresh.entry });
  assert.ok('subject' in result.inputsRecord.inputs, 'the input record carries the subject read');
  assert.equal(result.allowlist.checkpoints.subject.number, fixtures.unchanged.inputs.observation.finalized.number);
  const document = decisionEvidenceFor({ config: fresh, run, decision: result, producer: { interface: 'test' } });
  assert.equal(document.inputs.subject.native.decimals, 6);
  assert.deepEqual(document.checkpoints.subject, fixtures.unchanged.inputs.subject.block);
  assert.equal(reconstructDecision(document).ok, true, JSON.stringify(reconstructDecision(document).checks.filter((check) => !check.ok)));
  // An older subject read sets the deadline.
  const older = { ...fixtures.unchanged, inputs: { ...fixtures.unchanged.inputs, subject: { ...fixtures.unchanged.inputs.subject, observedAt: plus(fixtures.unchanged.inputs.observation.observedAt, -300_000) } } };
  const olderRun = runFixture(fresh, older);
  const validity = decisionValidity({ policy: fresh.policy, report: olderRun.report, inputs: olderRun.inputs, evaluatedAt: olderRun.now.toISOString() });
  assert.equal(validity.limitedBy, 'subject');
  assert.equal(validity.validUntil, plus(older.inputs.subject.observedAt, 900_000));
  const legacyValidity = decisionValidity({ policy: legacy.policy, report: olderRun.report, inputs: olderRun.inputs, evaluatedAt: olderRun.now.toISOString() });
  assert.equal(legacyValidity.limitedBy, 'observation', 'under the legacy policy the subject read is not a limit');
  const olderDocument = decisionEvidenceFor({ config: fresh, run: olderRun, decision: decide(fresh, olderRun, { entry: fresh.entry }), producer: { interface: 'test' } });
  assert.equal(olderDocument.validity.limitedBy, 'subject');
  assert.equal(reconstructDecision(olderDocument).ok, true);
});
