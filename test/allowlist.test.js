// Offline refusal cases for the allow-list, run with `node --test`. Every scenario
// replays reads captured live on the Portaldot V3 testnet (see fixtures/) through the
// real check command, so the exit code, the allow-list document and the evaluation
// document are all exercised. No network is touched here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { policyHash, verifyBinding } from 'revivecheck/policy';
import { fingerprint, verifyRun } from 'revivecheck/report';
import { ALLOWLIST_SCHEMA, ENTRY_FIELDS, approvedEntry, buildAllowlist, canonicalEntry, compareEntry } from '../src/allowlist.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const config = readJson('config/allowlist.json');
const SUBJECT = '0x00001e6100000000000000000000000000010000';
const UPSTREAM_POLICY_HASH = 'ce1388f97d27489c770615d720ed39893e6250788eada8c45de6d8ab2b0534fd';

/** Run the check command offline into a fresh directory and load what it wrote. */
function check(...args) {
  const out = mkdtempSync(path.join(tmpdir(), 'revivecheck-consumer-'));
  const result = spawnSync(process.execPath, ['src/check.js', ...args, '--out', out], { cwd: root, encoding: 'utf8' });
  const read = (name) => JSON.parse(readFileSync(path.join(out, name), 'utf8'));
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, allowlist: read('allowlist.json'), evaluation: read('evaluation.json'), inputs: read('inputs.json') };
}
const codes = (run) => run.allowlist.denied[0]?.reasons ?? [];

test('the vendored tarball matches CHECKSUMS.txt and the documented exports resolve from it', async () => {
  const line = readFileSync(path.join(root, 'vendor/CHECKSUMS.txt'), 'utf8').split('\n').find((text) => /^[a-f0-9]{64}\s+revivecheck-0\.5\.0\.tgz$/.test(text));
  assert.ok(line, 'CHECKSUMS.txt names the tarball');
  const actual = createHash('sha256').update(readFileSync(path.join(root, 'vendor/revivecheck-0.5.0.tgz'))).digest('hex');
  assert.equal(actual, line.split(/\s+/)[0]);
  const pkg = (await import('revivecheck/package.json', { with: { type: 'json' } })).default;
  assert.equal(pkg.version, '0.5.0');
  for (const [specifier, names] of [['revivecheck/catalog-release', ['buildCatalogRelease', 'verifyCatalogRelease', 'readCatalogRelease', 'compareCatalogReleases', 'releaseDiagnostics', 'gateOutcome', 'loadConsumerConfig', 'selectorFrom']], ['revivecheck/entry', ['approvedEntry', 'compareEntry', 'entryDecision']], ['revivecheck/current', ['initialDecision', 'beginCheck', 'settleCheck', 'failCheck', 'canAct', 'checkPermission', 'decisionValidity']], ['revivecheck/decision', ['buildDecisionEvidence', 'reconstructDecision', 'decisionSheetHtml', 'explainReason', 'RENEWAL_STEPS']]]) {
    const module = await import(specifier);
    for (const name of names) assert.equal(typeof module[name] === 'function' || typeof module[name] === 'object', true, `${specifier}.${name}`);
  }
  const policy = await import('revivecheck/policy');
  const service = await import('revivecheck/service');
  const report = await import('revivecheck/report');
  for (const name of ['normalizePolicy', 'policyHash', 'createBinding', 'verifyBinding', 'evaluateBinding', 'summarizeEvaluation']) assert.equal(typeof policy[name], 'function', `policy.${name}`);
  assert.equal(typeof policy.REASONS, 'object');
  for (const name of ['collectPolicyInputs', 'evaluatePolicy', 'retrieveEvidence', 'readRegistry', 'readTokenList', 'networkStatus', 'closeConnections']) assert.equal(typeof service[name], 'function', `service.${name}`);
  for (const name of ['verifyRun', 'validateImportedRun', 'fingerprint', 'canonical']) assert.equal(typeof report[name], 'function', `report.${name}`);
  await service.closeConnections();
});

test('valid revision 2 with the correct entry: allowed, exit 0, entry derived from the approved report', () => {
  const run = check('--fixture', 'fixtures/valid-r2.json');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.allowlist.schema, ALLOWLIST_SCHEMA);
  assert.equal(run.allowlist.allow.length, 1);
  assert.equal(run.allowlist.denied.length, 0);
  const entry = run.allowlist.allow[0];
  assert.deepEqual(Object.fromEntries(ENTRY_FIELDS.map((field) => [field, entry[field]])), canonicalEntry(config.entry));
  assert.equal(entry.source, 'approved-report');
  assert.equal(entry.reportHash, '1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51');
  assert.equal(entry.revision, '2');
  assert.equal(run.evaluation.status, 'valid');
  assert.equal(run.evaluation.enable, true);
  assert.equal(run.allowlist.policyHash, policyHash(config.policy));
  assert.equal(run.allowlist.policyHash, run.evaluation.policyHash);
  assert.notEqual(run.allowlist.policyHash, UPSTREAM_POLICY_HASH, 'this consumer evaluates under its own policy, not the upstream example policy');
  assert.equal(run.inputs.fixture.provenance.upstreamPolicyHash, UPSTREAM_POLICY_HASH, 'the fixture records where its raw reads came from');
  assert.equal(run.allowlist.evaluationHash, run.evaluation.evaluationHash);
  assert.ok(verifyBinding(run.inputs.binding, config.policy), 'the binding was made under this policy');
  assert.equal(run.allowlist.checkpoints.registry.number, '187279');
  assert.equal(run.allowlist.checkpoints.storage.blockNumber, '187145');
  assert.equal(run.allowlist.evaluatedAt, '2026-10-25T09:43:18.329Z');
});

test('wrong decimals in the configuration: denied with entry-mismatch:decimals although the policy holds', () => {
  const run = check('--fixture', 'fixtures/valid-r2.json', '--config', 'fixtures/config-wrong-decimals.json');
  assert.equal(run.status, 1);
  assert.equal(run.evaluation.status, 'valid', 'the policy evaluation itself is valid');
  assert.equal(run.allowlist.allow.length, 0);
  assert.deepEqual(codes(run), ['entry-mismatch:decimals']);
  assert.deepEqual(run.allowlist.denied[0].entry.mismatches, [{ field: 'decimals', configured: 18, approved: 6 }]);
  assert.match(run.allowlist.denied[0].nextAction, /^Do not enable/);
});

test('binding on the superseded revision 1 (eb960cc7…): recheck-required with revision-superseded', () => {
  const run = check('--fixture', 'fixtures/superseded-r1.json');
  assert.equal(run.status, 1);
  assert.equal(run.evaluation.status, 'recheck-required');
  assert.ok(codes(run).includes('revision-superseded'), codes(run).join(','));
  assert.equal(run.inputs.binding.revision, '1');
  assert.equal(run.inputs.binding.reportHash, 'eb960cc73214722f3c0cbf3a87caae572d44aafa69219d2c53b492b85e7622b8');
  assert.equal(run.inputs.inputs.registry.release.revision, '2');
  assert.equal(run.allowlist.allow.length, 0);
});

test('trusted reviewer requested changes: recheck-required with approval-revoked', () => {
  const run = check('--fixture', 'fixtures/revoked-r2.json');
  assert.equal(run.status, 1);
  assert.equal(run.evaluation.status, 'recheck-required');
  assert.ok(codes(run).includes('approval-revoked'), codes(run).join(','));
  assert.equal(run.allowlist.allow.length, 0);
});

test('every read replaced with an error: unknown, denied, no checkpoint', () => {
  const run = check('--fixture', 'fixtures/unavailable.json');
  assert.equal(run.status, 1);
  assert.equal(run.evaluation.status, 'unknown');
  for (const code of ['observation-missing', 'registry-unavailable', 'consumer-unavailable', 'storage-unverified']) assert.ok(codes(run).includes(code), code);
  assert.equal(run.allowlist.allow.length, 0);
  assert.deepEqual(run.allowlist.checkpoints, { registry: null, observation: null, listing: null, storage: null, report: run.allowlist.checkpoints.report });
  assert.match(run.allowlist.denied[0].nextAction, /Unavailable verification never counts as valid/);
});

test('evaluated eight days after the capture: expired with evidence-expired (the policy clock, not a chain event)', () => {
  const run = check('--fixture', 'fixtures/valid-r2.json', '--now', '2026-11-02T09:43:18.329Z');
  assert.equal(run.status, 1);
  assert.equal(run.evaluation.status, 'expired');
  assert.ok(codes(run).includes('evidence-expired'), codes(run).join(','));
  assert.equal(new Set(codes(run)).size, codes(run).length, 'reason codes are listed once each');
  assert.equal(run.allowlist.allow.length, 0);
});

test('approvedEntry derives the entry from the report and refuses tampered or non-passing reports', () => {
  const { report } = readJson('fixtures/valid-r2.json');
  const approved = approvedEntry(report);
  assert.equal(approved.reason, null);
  assert.deepEqual(approved.entry, canonicalEntry(config.entry));
  assert.equal(approved.reportHash, report.evidenceHash);
  assert.equal(approved.entry.address, SUBJECT);

  const tampered = structuredClone(report);
  tampered.input.listing.decimals = 18;
  assert.equal(verifyRun(tampered), false);
  assert.equal(approvedEntry(tampered).reason, 'the report fails its integrity check');

  // Re-seal a modified copy (SHA-256 of the canonical report without evidenceHash, as docs/API.md states) so the semantic rules are reached.
  const reseal = (mutate) => { const { evidenceHash, ...rest } = structuredClone(report); mutate(rest); return { ...rest, evidenceHash: fingerprint(rest) }; };
  const failedListing = reseal((copy) => { copy.checks.find((item) => item.id === 'token.listing').status = 'failed'; });
  assert.equal(verifyRun(failedListing), true);
  assert.equal(approvedEntry(failedListing).reason, 'the report has no passed token.listing check');
  const notPassed = reseal((copy) => { copy.status = 'failed'; });
  assert.equal(approvedEntry(notPassed).reason, 'the report did not pass (failed)');
  const claimDrift = reseal((copy) => { copy.input.listing.decimals = 18; });
  assert.equal(approvedEntry(claimDrift).reason, 'the token.listing evidence for decimals does not match the report\'s listing claim');
});

test('compareEntry names every differing field in canonical order', () => {
  const result = compareEntry({ ...config.entry, symbol: 'PUSD', decimals: 18 }, canonicalEntry(config.entry));
  assert.equal(result.match, false);
  assert.deepEqual(result.mismatches.map((item) => item.field), ['symbol', 'decimals']);
  assert.equal(compareEntry({ ...config.entry, address: config.entry.address.toUpperCase().replace('0X', '0x') }, config.entry).match, true, 'address casing never matters');
});

test('buildAllowlist without a retrieved report denies with storage-unverified and entry-unverified', () => {
  const document = buildAllowlist({ config, policyHash: policyHash(config.policy), binding: null, evaluation: null, report: null, source: 'test', retrieval: { verified: false, reasons: ['simulated'] } });
  assert.equal(document.allow.length, 0);
  assert.deepEqual(document.denied[0].reasons, ['storage-unverified', 'entry-unverified']);
  assert.equal(document.denied[0].status, 'unknown');
  assert.equal(document.evaluationHash, null);
});
