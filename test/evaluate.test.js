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
import { initialDecision, beginCheck, settleCheck, failCheck, canAct, ageDecision } from 'revivecheck/current';
import { loadConfig, runFixture, decide } from '../src/evaluate.js';
import { decisionEvidenceFor } from '../src/decision-evidence.js';
import { selectorOptions, canProceed } from '../src/selector.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const config = loadConfig(readJson('config/allowlist.json'));
const fixtures = Object.fromEntries(['valid-r2', 'superseded-r1', 'revoked-r2', 'unavailable'].map((name) => [name, readJson(`fixtures/${name}.json`)]));
const WRONG = { ...config.entry, decimals: 18 };
const EXPIRY = '2026-11-01T09:29:17.646Z';

/** What the browser does after a check: settle the current decision with the evaluator's output. */
function settled(run, result, entry) {
  const begun = beginCheck(initialDecision({ selection: { mode: 'live', entry } }));
  return settleCheck(begun, { request: begun.request, evaluation: result.evaluation, entry: entryDecision(entry, run.report), inputs: run.inputs, extra: { allowlist: result.allowlist, run, result } });
}

test('the wrong entry is denied with the field named, the corrected entry is allowed, and the selector follows the allow-list output', () => {
  const run = runFixture(config, fixtures['valid-r2']);
  const wrong = decide(config, run, { entry: WRONG });
  assert.equal(wrong.allowed, false);
  assert.equal(wrong.evaluation.status, 'valid', 'the policy holds; the entry does not');
  assert.deepEqual(wrong.allowlist.denied[0].reasons, ['entry-mismatch:decimals']);
  const withheld = settled(run, wrong, WRONG);
  assert.equal(canAct(withheld), false);
  const options = selectorOptions(withheld, { subject: config.entry });
  assert.equal(options[0].selectable, false);
  assert.match(options[0].reason, /entry-mismatch:decimals/);
  assert.equal(canProceed(options, options[0].id), false);
  assert.equal(canProceed(options, 'native'), true, 'the native option never depends on the policy');

  const corrected = decide(config, run, { entry: config.entry });
  assert.equal(corrected.allowed, true);
  const available = settled(run, corrected, config.entry);
  assert.equal(canAct(available), true);
  const allowed = selectorOptions(available, { subject: config.entry });
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
    assert.equal(canAct(decision), false, name);
    const options = selectorOptions(decision, { subject: config.entry });
    assert.equal(options[0].selectable, false, name);
    assert.ok(options[0].reason.startsWith('Withheld:'), `${name}: ${options[0].reason}`);
  }
  const begun = beginCheck(initialDecision({ selection: { mode: 'live', entry: config.entry } }));
  const failed = failCheck(begun, { request: begun.request, error: new Error('timed out'), kind: 'timeout' });
  assert.equal(selectorOptions(failed, { subject: config.entry })[0].selectable, false);
  assert.match(selectorOptions(failed, { subject: config.entry })[0].reason, /never enables/);
  const run = runFixture(config, fixtures['valid-r2']);
  const fresh = settled(run, decide(config, run, { entry: config.entry }), config.entry);
  const lapsed = ageDecision(fresh, { now: new Date(Date.parse(fixtures['valid-r2'].now) + 901_000), maxObservationAgeSeconds: config.policy.evidence.maxObservationAgeSeconds });
  assert.equal(canAct(lapsed), false);
  assert.match(selectorOptions(lapsed, { subject: config.entry })[0].reason, /older than the observation limit/);
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
