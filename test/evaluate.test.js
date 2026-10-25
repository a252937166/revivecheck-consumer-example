// The shared evaluator (src/evaluate.js), the portable decision document and the token
// selector, all offline. The browser interface uses exactly these modules, so what is
// proven here about denial, recovery and selection holds for the page as well.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconstructDecision, DECISION_EVIDENCE_SCHEMA, evidenceExpiry } from 'revivecheck/decision';
import { entryDecision } from 'revivecheck/entry';
import { initialDecision, beginCheck, settleCheck, failCheck, canAct, checkPermission, ageDecision } from 'revivecheck/current';
import { evaluateBinding } from 'revivecheck/policy';
import { loadConfig, runFixture, decide } from '../src/evaluate.js';
import { decisionEvidenceFor } from '../src/decision-evidence.js';
import { selectorOptions, canProceed, proceedNow } from '../src/selector.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const config = loadConfig(readJson('config/allowlist.json'));
const fixtures = Object.fromEntries(['valid-r2', 'superseded-r1', 'revoked-r2', 'unavailable'].map((name) => [name, readJson(`fixtures/${name}.json`)]));
const WRONG = { ...config.entry, decimals: 18 };
const EXPIRY = '2026-11-01T09:29:17.646Z';
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

/** What the browser does after a check: settle the current decision with the evaluator's output, the policy and the report, at the run's clock. */
function settled(run, result, entry) {
  const begun = beginCheck(initialDecision({ selection: { mode: 'live', entry } }));
  return settleCheck(begun, { request: begun.request, evaluation: result.evaluation, entry: entryDecision(entry, run.report), inputs: run.inputs, policy: config.policy, report: run.report, settledAt: run.now.toISOString(), extra: { allowlist: result.allowlist, run, result } });
}
/** The same reads, re-dated so that an evaluation at `at` sees them a few seconds old (the fixture's reads are fixed in time). */
function redated(run, at, ages = { observation: 4000, registry: 3000, listing: 2000 }) {
  const inputs = { ...run.inputs };
  for (const [key, age] of Object.entries(ages)) inputs[key] = { ...run.inputs[key], observedAt: plus(at, -age) };
  return { ...run, inputs, now: new Date(at) };
}

test('the wrong entry is denied with the field named, the corrected entry is allowed, and the selector follows the allow-list output', () => {
  const run = runFixture(config, fixtures['valid-r2']);
  const wrong = decide(config, run, { entry: WRONG });
  assert.equal(wrong.allowed, false);
  assert.equal(wrong.evaluation.status, 'valid', 'the policy holds; the entry does not');
  assert.deepEqual(wrong.allowlist.denied[0].reasons, ['entry-mismatch:decimals']);
  const withheld = settled(run, wrong, WRONG);
  assert.equal(canAct(withheld, { now: run.now }), false);
  const options = selectorOptions(withheld, { subject: config.entry, now: run.now });
  assert.equal(options[0].selectable, false);
  assert.match(options[0].reason, /entry-mismatch:decimals/);
  assert.equal(canProceed(options, options[0].id), false);
  assert.equal(canProceed(options, 'native'), true, 'the native option never depends on the policy');

  const corrected = decide(config, run, { entry: config.entry });
  assert.equal(corrected.allowed, true);
  const available = settled(run, corrected, config.entry);
  assert.equal(canAct(available, { now: run.now }), true);
  assert.equal(canAct(available), false, 'at the real clock the 2026-10-25 reads have long passed their deadline');
  const allowed = selectorOptions(available, { subject: config.entry, now: run.now });
  assert.equal(allowed[0].selectable, true);
  assert.equal(allowed[0].entry.reportHash, config.release.reportHash, 'the option carries the approved entry, derived from the report');
  assert.equal(allowed[0].entry.decimals, 6);
  assert.equal(canProceed(allowed, allowed[0].id), true);
});

test('every refusal leaves the selector unavailable: superseded, revoked, unavailable, expired, failed check, lapsed result', () => {
  for (const [name, now] of [['superseded-r1'], ['revoked-r2'], ['unavailable'], ['valid-r2', '2026-11-02T09:43:18.329Z']]) {
    const run = runFixture(config, fixtures[name], { now });
    const result = decide(config, run, { entry: config.entry });
    assert.equal(result.allowed, false, name);
    const decision = settled(run, result, config.entry);
    assert.equal(canAct(decision, { now: run.now }), false, name);
    const options = selectorOptions(decision, { subject: config.entry, now: run.now });
    assert.equal(options[0].selectable, false, name);
    assert.ok(options[0].reason.startsWith('Withheld:'), `${name}: ${options[0].reason}`);
  }
  const begun = beginCheck(initialDecision({ selection: { mode: 'live', entry: config.entry } }));
  const failed = failCheck(begun, { request: begun.request, error: new Error('timed out'), kind: 'timeout' });
  assert.equal(selectorOptions(failed, { subject: config.entry })[0].selectable, false);
  assert.match(selectorOptions(failed, { subject: config.entry })[0].reason, /never enables/);
  const run = runFixture(config, fixtures['valid-r2']);
  const fresh = settled(run, decide(config, run, { entry: config.entry }), config.entry);
  const deadline = fresh.current.validity.validUntil;
  const lapsed = ageDecision(fresh, { now: plus(deadline, 1) });
  assert.equal(canAct(lapsed, { now: plus(deadline, 1) }), false);
  assert.match(selectorOptions(lapsed, { subject: config.entry, now: plus(deadline, 1) })[0].reason, /^Lapsed: the permission of the last result ended at/);
});

test('the permission ends at the deadline the reads set, not at the evaluation time plus the limit; Continue checks the clock itself', () => {
  const run = runFixture(config, fixtures['valid-r2']);
  const fresh = settled(run, decide(config, run, { entry: config.entry }), config.entry);
  const { validity } = fresh.current;
  assert.equal(validity.validUntil, plus(run.inputs.observation.observedAt, 900_000), 'the network read plus 900 s');
  assert.equal(validity.limitedBy, 'observation');
  assert.ok(Date.parse(validity.validUntil) < run.now.getTime() + 900_000 + 60_000, 'never the evaluation time plus the limit plus the future allowance');
  const subject = config.entry.address.toLowerCase();
  assert.equal(proceedNow(fresh, { subject: config.entry, chosen: subject, now: validity.validUntil }).ok, true, 'valid at the exact deadline');
  const late = proceedNow(fresh, { subject: config.entry, chosen: subject, now: plus(validity.validUntil, 1) });
  assert.equal(late.ok, false, 'denied one millisecond later, although no timer marked the decision stale');
  assert.equal(fresh.stale, false);
  assert.match(late.reason, /Lapsed/);
  assert.equal(late.permission.reason, 'lapsed');
  assert.equal(proceedNow(fresh, { subject: config.entry, chosen: 'native', now: plus(validity.validUntil, 1) }).ok, true, 'the native option never depends on the policy');
  // The evaluator agrees at the boundary.
  const binding = run.binding, report = run.report;
  assert.equal(evaluateBinding({ policy: config.policy, binding, report, ...run.inputs, now: validity.validUntil }).status, 'valid');
  assert.equal(evaluateBinding({ policy: config.policy, binding, report, ...run.inputs, now: plus(validity.validUntil, 1) }).status, 'unknown');
});

test('a result evaluated one second before the report expires ends at the report deadline, and reads already 899 s old leave one second', () => {
  const run = runFixture(config, fixtures['valid-r2']);
  const nearExpiry = redated(run, plus(EXPIRY, -1000));
  const result = decide(config, nearExpiry, { entry: config.entry });
  assert.equal(result.allowed, true, 'valid one second before the report expires');
  const decision = settled(nearExpiry, result, config.entry);
  assert.equal(decision.current.validity.validUntil, EXPIRY);
  assert.equal(decision.current.validity.limitedBy, 'report');
  const subject = config.entry.address.toLowerCase();
  assert.equal(proceedNow(decision, { subject: config.entry, chosen: subject, now: EXPIRY }).ok, true);
  const after = proceedNow(decision, { subject: config.entry, chosen: subject, now: plus(EXPIRY, 1) });
  assert.equal(after.ok, false);
  assert.match(after.reason, /report's age limit/);
  assert.equal(decide(config, { ...nearExpiry, now: new Date(plus(EXPIRY, 1)) }, { entry: config.entry }).evaluation.status, 'expired', 'the evaluator says the same two seconds later');

  const old = redated(run, '2026-10-25T10:00:00.000Z', { observation: 899_000, registry: 899_000, listing: 899_000 });
  const oldResult = decide(config, old, { entry: config.entry });
  assert.equal(oldResult.allowed, true, 'valid: the reads are within the limit at the evaluation');
  const oldDecision = settled(old, oldResult, config.entry);
  assert.equal(oldDecision.current.validity.validUntil, '2026-10-25T10:00:01.000Z', 'one second of permission, not another 900');
  assert.equal(canAct(oldDecision, { now: '2026-10-25T10:00:01.000Z' }), true);
  assert.equal(canAct(oldDecision, { now: '2026-10-25T10:00:02.000Z' }), false);
  assert.equal(decide(config, { ...old, now: new Date('2026-10-25T10:00:02.000Z') }, { entry: config.entry }).evaluation.status, 'unknown', 'the evaluator calls the reads stale two seconds later');

  const undated = settleCheck(beginCheck(initialDecision({ selection: { mode: 'live', entry: config.entry } })), { request: 1, evaluation: result.evaluation, entry: entryDecision(config.entry, run.report), inputs: nearExpiry.inputs, policy: config.policy, report: null, settledAt: plus(EXPIRY, -1000) });
  assert.equal(undated.current.available, false, 'without the report no deadline can be derived, so nothing is permitted');
  assert.equal(checkPermission(undated, { now: plus(EXPIRY, -1000) }).reason, 'validity-unknown');
  assert.equal(selectorOptions(undated, { subject: config.entry, now: plus(EXPIRY, -1000) })[0].selectable, false);
});

test('the evidence age boundary: acceptable at the limit, expired one millisecond later', () => {
  const run = runFixture(config, fixtures['valid-r2']);
  assert.equal(evidenceExpiry(run.report, config.policy).expiresAt, EXPIRY);
  const atLimit = decide(config, runFixture(config, fixtures['valid-r2'], { now: EXPIRY }), { entry: config.entry });
  assert.equal(atLimit.evaluation.reasons.some((reason) => reason.code === 'evidence-expired'), false, 'not expired at the limit itself');
  const past = decide(config, runFixture(config, fixtures['valid-r2'], { now: '2026-11-01T09:29:17.647Z' }), { entry: config.entry });
  assert.equal(past.evaluation.status, 'expired');
  assert.ok(past.evaluation.reasons.some((reason) => reason.code === 'evidence-expired'));
  assert.equal(past.allowed, false);
});

test('the decision-evidence document reconstructs offline for an allowed, a withheld and an unknown decision, and the CLI agrees', () => {
  const cases = [
    ['valid-r2', config.entry, true],
    ['valid-r2', WRONG, false],
    ['revoked-r2', config.entry, false],
    ['unavailable', config.entry, false],
  ];
  const dir = mkdtempSync(path.join(tmpdir(), 'revivecheck-consumer-evidence-'));
  for (const [name, entry, allowed] of cases) {
    const run = runFixture(config, fixtures[name]);
    const result = decide(config, run, { entry });
    const document = decisionEvidenceFor({ config, run, decision: result });
    assert.equal(document.schema, DECISION_EVIDENCE_SCHEMA, name);
    assert.equal(document.outcome.available, allowed, name);
    assert.equal(document.producer.name, config.name);
    if (allowed) assert.equal(document.validity.validUntil, plus(run.inputs.observation.observedAt, 900_000), `${name}: the document carries the permission deadline`);
    assert.equal(document.identity.reportHash, run.report.evidenceHash);
    assert.ok(document.outcome.explanations.every((item) => item.who && item.then), `${name}: every refusal names who acts and what happens next`);
    const reconstruction = reconstructDecision(document);
    assert.equal(reconstruction.ok, true, `${name}: ${JSON.stringify(reconstruction.checks.filter((check) => !check.ok))}`);
    const file = path.join(dir, `${name}-${entry.decimals}.json`);
    writeFileSync(file, JSON.stringify(document));
    const cli = spawnSync(process.execPath, ['src/reconstruct.js', file], { cwd: root, encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.match(cli.stdout, /consistent: the stated decision follows/);
    const tampered = structuredClone(document);
    tampered.outcome.available = !tampered.outcome.available;
    writeFileSync(file, JSON.stringify(tampered));
    assert.equal(spawnSync(process.execPath, ['src/reconstruct.js', file], { cwd: root, encoding: 'utf8' }).status, 1, `${name}: a changed outcome fails reconstruction`);
  }
});

test('the check command writes the decision-evidence document, and the one in out/ is for the configured entry', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'revivecheck-consumer-'));
  const result = spawnSync(process.execPath, ['src/check.js', '--fixture', 'fixtures/valid-r2.json', '--out', out], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const document = JSON.parse(readFileSync(path.join(out, 'decision-evidence.json'), 'utf8'));
  assert.equal(reconstructDecision(document).ok, true);
  assert.match(result.stdout, /decision-evidence\.json/);
});
