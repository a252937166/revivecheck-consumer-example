// One evaluator for the command line and the browser. Live mode fetches the bound report
// FROM THE CHAIN with `retrieveEvidence`, creates this consumer's binding, collects fresh
// reads with `collectPolicyInputs` and evaluates with `evaluateBinding`. Fixture mode
// replays captured reads through the same code path. Nothing here signs anything; every
// read is public. The `service` module is passed in, so a browser can hand over the
// bundle it loaded on demand and Node the module it imported.
//
// The configuration boundary guards the installed implementation: a policy requirement
// this configuration requests (`evidence.requireFreshSubject`, or any later option set to
// true) that the installed `normalizePolicy` does not retain makes the configuration
// unusable here, and the error names it. An older package that silently dropped the
// option would otherwise evaluate a weaker policy under the old fingerprint. A legacy
// configuration without such options passes unchanged.
import { createBinding, evaluateBinding, normalizePolicy, policyHash } from 'revivecheck/policy';
import { buildAllowlist, CONFIG_SCHEMA } from './allowlist.js';

export const FIXTURE_SCHEMA = 'revivecheck-consumer.fixture.v1';
export const INPUTS_SCHEMA = 'revivecheck-consumer.inputs.v1';
/** The reads every policy needs; `readsFor` adds the subject read when the policy requires a fresh one. */
export const READS = Object.freeze(['observation', 'registry', 'listing', 'evidence']);
export const readsFor = (policy) => normalizePolicy(policy).evidence.requireFreshSubject === true ? [...READS, 'subject'] : [...READS];
const elapsed = (start) => Date.now() - start;

/**
 * The capability guard, implemented here (not only in the library) so that it holds
 * against whatever `normalize` is installed: every `evidence.*` requirement requested as
 * `true` must come back `true` from the normalizer, or the configuration is refused.
 */
export function assertRequirementsRetained(requested, normalized) {
  const dropped = Object.entries(requested?.evidence ?? {}).filter(([, value]) => value === true).map(([key]) => key).filter((key) => normalized?.evidence?.[key] !== true);
  if (dropped.length) throw new Error(`The installed revivecheck package does not retain the requested policy requirement${dropped.length === 1 ? '' : 's'} ${dropped.map((key) => `evidence.${key}`).join(', ')}; this consumer refuses the configuration instead of evaluating a weaker policy.`);
  return normalized;
}

/** Validate the configuration document; throws with the field named. `normalize` is the installed normalizer by default and injectable for the guard's tests. */
export function loadConfig(config, name = 'config', { normalize = normalizePolicy } = {}) {
  if (config?.schema !== CONFIG_SCHEMA) throw new Error(`${name} declares schema ${CONFIG_SCHEMA}.`);
  assertRequirementsRetained(config.policy, normalize(config.policy));
  for (const key of ['label', 'owner', 'releaseId', 'revision', 'reportHash', 'storage']) if (config.release?.[key] === undefined) throw new Error(`${name}: release.${key} is required.`);
  if (!config.entry || !config.boundBy) throw new Error(`${name}: entry and boundBy are required.`);
  return config;
}

/** The binding this consumer makes: its own policy, the exact report, the release and revision it relies on. */
export function bind(config, report, target, { id, boundAt } = {}) {
  return createBinding({
    policy: config.policy, report, releaseId: target.releaseId, revision: String(target.revision),
    boundBy: config.boundBy, note: `Allow-list binding for ${config.release.label}: report ${report.evidenceHash.slice(0, 12)}… on revision ${target.revision}.`,
    storage: target.storage ?? null, ...(id ? { id } : {}), ...(boundAt ? { boundAt } : {}),
  });
}

/** Offline: the reads come from a fixture; the clock is the capture time unless `now` overrides it. */
export function runFixture(config, fixture, { now: nowOverride, name = fixture.name } = {}) {
  if (fixture.schema !== FIXTURE_SCHEMA) throw new Error(`The fixture declares schema ${fixture.schema}, not ${FIXTURE_SCHEMA}.`);
  const now = new Date(nowOverride ?? fixture.now);
  const binding = bind(config, fixture.report, fixture.binding, { id: `fixture-${fixture.name}`, boundAt: fixture.now });
  return { source: `fixture:${name}`, report: fixture.report, binding, inputs: fixture.inputs, now, retrieval: fixture.inputs.evidence ?? null, attempts: [], fixture: { name: fixture.name, expect: fixture.expect ?? null, provenance: fixture.provenance ?? null, capturedAt: fixture.now, clockOverride: nowOverride ?? null } };
}

/**
 * Live: retrieve the bound report from chain data, then collect fresh reads. Retries when
 * the public nodes do not answer; every attempt is recorded. `onPhase` reports progress.
 */
export async function runLive(config, { service, now: nowOverride, retries = 3, onPhase = () => {}, log = () => {} } = {}) {
  const { extrinsicHash, blockHash } = config.release.storage;
  const target = { releaseId: config.release.releaseId, revision: String(config.release.revision), storage: { extrinsicHash, blockHash } };
  const attempts = [];
  let report = null, binding = null, inputs = null, retrieval = null;
  try {
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const started = Date.now();
      const record = { attempt, startedAt: new Date(started).toISOString() };
      try {
        if (!report) {
          onPhase({ attempt, phase: 'retrieve', text: 'Retrieving the bound report from the chain (remark.store extrinsic)…' });
          const result = await service.retrieveEvidence({ extrinsicHash, blockHash, expectedHash: config.release.reportHash });
          record.retrieveEvidenceMs = elapsed(started);
          const { run, ...rest } = result;
          retrieval = rest;
          if (!result.verified || !run) {
            record.ok = false; record.failure = `retrieveEvidence: ${(result.reasons || []).join(' ') || 'not verified'}`; record.ms = elapsed(started);
            attempts.push(record); log(`attempt ${attempt}: ${record.failure}`);
            await service.closeConnections().catch(() => {});
            continue;
          }
          report = run; // the report comes from the chain, not from a file
          binding = bind(config, report, target);
          log(`attempt ${attempt}: retrieved report ${report.evidenceHash.slice(0, 12)}… from block #${result.blockNumber} (${record.retrieveEvidenceMs} ms)`);
        }
        onPhase({ attempt, phase: 'collect', text: 'Reading the network, the ReleaseRegistry, the VerifiedTokenList and the stored report at finalized blocks through both interfaces…' });
        const collected = Date.now();
        inputs = await service.collectPolicyInputs({ policy: config.policy, binding });
        record.collectPolicyInputsMs = elapsed(collected);
        // Every read the policy requires counts as a failed read when it errs, the subject read included: a retry re-reads, it never drops the requirement.
        const failed = readsFor(config.policy).filter((key) => inputs[key]?.error).map((key) => `${key}: ${inputs[key].error}`);
        record.ok = failed.length === 0; record.failedReads = failed; record.ms = elapsed(started);
        attempts.push(record);
        if (failed.length) {
          log(`attempt ${attempt}: ${failed.length} read(s) failed: ${failed.join('; ')}`);
          if (attempt < retries) { await service.closeConnections().catch(() => {}); continue; }
        }
        break;
      } catch (error) {
        record.ok = false; record.failure = error.message; record.ms = elapsed(started);
        attempts.push(record); log(`attempt ${attempt}: ${error.message}`);
        await service.closeConnections().catch(() => {});
      }
    }
  } finally {
    await service.closeConnections().catch(() => {});
  }
  return { source: 'live:portaldot-v3-testnet', report, binding, inputs, now: new Date(nowOverride ?? Date.now()), retrieval, attempts, fixture: null };
}

/**
 * The decision: the policy evaluation (when the report was retrieved) and the allow-list
 * document derived from it. `entry` is the entry the operator intends to publish; it
 * defaults to the configuration's entry and can be overridden by a corrected one.
 */
export function decide(config, run, { entry = config.entry } = {}) {
  const hash = policyHash(config.policy);
  const effective = { ...config, entry };
  const evaluation = run.binding && run.inputs ? evaluateBinding({ policy: config.policy, binding: run.binding, report: run.report, ...run.inputs, now: run.now }) : null;
  const allowlist = buildAllowlist({ config: effective, policyHash: hash, binding: run.binding, evaluation, report: run.report, source: run.source, retrieval: run.retrieval, generatedAt: run.now.toISOString() });
  const inputsRecord = {
    schema: INPUTS_SCHEMA, source: run.source, collectedAt: run.inputs?.collectedAt ?? run.now.toISOString(), now: run.now.toISOString(), policyHash: hash,
    attempts: run.attempts, retrieval: run.retrieval, binding: run.binding, fixture: run.fixture,
    // The subject read travels with the record when the policy required it: it bounds the permission deadline and is needed to reconstruct the decision.
    inputs: run.inputs ? { observation: run.inputs.observation, registry: run.inputs.registry, listing: run.inputs.listing, evidence: run.inputs.evidence, ...(run.inputs.subject !== undefined ? { subject: run.inputs.subject } : {}) } : null,
  };
  const allowed = allowlist.allow.length === 1 && allowlist.denied.length === 0;
  return { policyHash: hash, evaluation, allowlist, inputsRecord, allowed, entry };
}
