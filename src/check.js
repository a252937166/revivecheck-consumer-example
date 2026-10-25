#!/usr/bin/env node
// Decide whether the configured token may be on this DEX allow-list.
//
//   node src/check.js                                   live: read the Portaldot V3 testnet
//   node src/check.js --fixture fixtures/<name>.json    offline: replay captured reads
//
// Options: --config <file> (default config/allowlist.json), --out <dir> (default out),
//          --now <ISO time> (the evaluator's clock; defaults to the fixture's capture time
//          or the real clock), --retries <n> (live only, default 3).
//
// Live mode fetches the bound report FROM THE CHAIN with `retrieveEvidence` (the stored
// remark.store extrinsic named in the configuration), so no report file is copied from
// any workspace. It then creates the binding, collects fresh reads with
// `collectPolicyInputs`, evaluates with `evaluateBinding`, derives the entry from the
// approved report and writes out/allowlist.json, out/evaluation.json and out/inputs.json.
// Exit code 0 only when the entry is allowed. Nothing is signed; every read is public.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createBinding, evaluateBinding, normalizePolicy, policyHash, summarizeEvaluation } from 'revivecheck/policy';
import { ALLOWLIST_SCHEMA, CONFIG_SCHEMA, buildAllowlist } from './allowlist.js';

const FIXTURE_SCHEMA = 'revivecheck-consumer.fixture.v1';
const INPUTS_SCHEMA = 'revivecheck-consumer.inputs.v1';
const READS = ['observation', 'registry', 'listing', 'evidence'];

const { values } = parseArgs({
  options: {
    config: { type: 'string', default: 'config/allowlist.json' },
    fixture: { type: 'string' },
    out: { type: 'string', default: 'out' },
    now: { type: 'string' },
    retries: { type: 'string', default: '3' },
  },
});

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const elapsed = (start) => Date.now() - start;

function loadConfig(config, file) {
  if (config?.schema !== CONFIG_SCHEMA) throw new Error(`${file} declares schema ${CONFIG_SCHEMA}.`);
  normalizePolicy(config.policy); // throws with the field name when the policy is malformed
  for (const key of ['label', 'owner', 'releaseId', 'revision', 'reportHash', 'storage']) if (config.release?.[key] === undefined) throw new Error(`${file}: release.${key} is required.`);
  if (!config.entry || !config.boundBy) throw new Error(`${file}: entry and boundBy are required.`);
  return config;
}

/** The binding this consumer makes: its own policy, the exact report, the release and revision it relies on. */
function bind(config, report, target, { id, boundAt } = {}) {
  return createBinding({
    policy: config.policy, report, releaseId: target.releaseId, revision: target.revision,
    boundBy: config.boundBy, note: `Allow-list binding for ${config.release.label}: report ${report.evidenceHash.slice(0, 12)}… on revision ${target.revision}.`,
    storage: target.storage ?? null, ...(id ? { id } : {}), ...(boundAt ? { boundAt } : {}),
  });
}

/** Offline: the reads come from a fixture; the clock is the capture time unless --now overrides it. */
async function fromFixture(config, file, nowOverride) {
  const fixture = await readJson(file);
  if (fixture.schema !== FIXTURE_SCHEMA) throw new Error(`${file} declares schema ${FIXTURE_SCHEMA}.`);
  const now = new Date(nowOverride ?? fixture.now);
  const report = fixture.report;
  const binding = bind(config, report, fixture.binding, { id: `fixture-${fixture.name}`, boundAt: fixture.now });
  return { source: `fixture:${path.basename(file)}`, report, binding, inputs: fixture.inputs, now, retrieval: fixture.inputs.evidence ?? null, attempts: [], fixture: { name: fixture.name, expect: fixture.expect ?? null, provenance: fixture.provenance ?? null } };
}

/** Live: retrieve the bound report from chain data, then collect fresh reads; retry when the public nodes do not answer. */
async function live(config, nowOverride, retries) {
  const service = await import('revivecheck/service');
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
          const result = await service.retrieveEvidence({ extrinsicHash, blockHash, expectedHash: config.release.reportHash });
          record.retrieveEvidenceMs = elapsed(started);
          const { run, ...rest } = result;
          retrieval = rest;
          if (!result.verified || !run) {
            record.ok = false; record.failure = `retrieveEvidence: ${(result.reasons || []).join(' ') || 'not verified'}`; record.ms = elapsed(started);
            attempts.push(record); console.error(`attempt ${attempt}: ${record.failure}`);
            await service.closeConnections().catch(() => {});
            continue;
          }
          report = run; // the report comes from the chain, not from a file
          binding = bind(config, report, target);
          console.error(`attempt ${attempt}: retrieved report ${report.evidenceHash.slice(0, 12)}… from block #${result.blockNumber} (${record.retrieveEvidenceMs} ms)`);
        }
        const collected = Date.now();
        inputs = await service.collectPolicyInputs({ policy: config.policy, binding });
        record.collectPolicyInputsMs = elapsed(collected);
        const failed = READS.filter((key) => inputs[key]?.error).map((key) => `${key}: ${inputs[key].error}`);
        record.ok = failed.length === 0; record.failedReads = failed; record.ms = elapsed(started);
        attempts.push(record);
        if (failed.length) {
          console.error(`attempt ${attempt}: ${failed.length} read(s) failed: ${failed.join('; ')}`);
          if (attempt < retries) { await service.closeConnections().catch(() => {}); continue; }
        }
        break;
      } catch (error) {
        record.ok = false; record.failure = error.message; record.ms = elapsed(started);
        attempts.push(record); console.error(`attempt ${attempt}: ${error.message}`);
        await service.closeConnections().catch(() => {});
      }
    }
  } finally {
    await service.closeConnections().catch(() => {});
  }
  return { source: 'live:portaldot-v3-testnet', report, binding, inputs, now: new Date(nowOverride ?? Date.now()), retrieval, attempts, fixture: null };
}

async function main() {
  const config = loadConfig(await readJson(values.config), values.config);
  const hash = policyHash(config.policy);
  const retries = Math.min(10, Math.max(1, Number.parseInt(values.retries, 10) || 3));
  const run = values.fixture ? await fromFixture(config, values.fixture, values.now) : await live(config, values.now, retries);
  const evaluation = run.binding && run.inputs ? evaluateBinding({ policy: config.policy, binding: run.binding, report: run.report, ...run.inputs, now: run.now }) : null;
  const allowlist = buildAllowlist({ config, policyHash: hash, binding: run.binding, evaluation, report: run.report, source: run.source, retrieval: run.retrieval, generatedAt: run.now.toISOString() });
  const inputsRecord = {
    schema: INPUTS_SCHEMA, source: run.source, collectedAt: run.inputs?.collectedAt ?? run.now.toISOString(), now: run.now.toISOString(), policyHash: hash,
    attempts: run.attempts, retrieval: run.retrieval, binding: run.binding, fixture: run.fixture,
    inputs: run.inputs ? { observation: run.inputs.observation, registry: run.inputs.registry, listing: run.inputs.listing, evidence: run.inputs.evidence } : null,
  };
  await mkdir(values.out, { recursive: true });
  await writeFile(path.join(values.out, 'allowlist.json'), `${JSON.stringify(allowlist, null, 2)}\n`);
  await writeFile(path.join(values.out, 'evaluation.json'), `${JSON.stringify(evaluation ?? { schema: null, status: 'unknown', reason: 'no evaluation: the bound report was not retrieved from the chain', attempts: run.attempts, retrieval: run.retrieval }, null, 2)}\n`);
  await writeFile(path.join(values.out, 'inputs.json'), `${JSON.stringify(inputsRecord, null, 2)}\n`);
  const allowed = allowlist.allow.length === 1 && allowlist.denied.length === 0;
  const verdict = evaluation ? summarizeEvaluation(evaluation) : 'unknown: the bound report was not retrieved';
  const entryNote = allowlist.denied[0]?.reasons.filter((reason) => reason.startsWith('entry-')).join(', ');
  console.log(`${allowed ? 'ALLOWED' : 'DENIED'} ${allowlist.denied[0]?.address ?? allowlist.allow[0].address} (${run.source})`);
  console.log(`policy ${hash.slice(0, 12)}… binding ${run.binding?.bindingHash?.slice(0, 12) ?? '-'}… evaluation ${evaluation?.evaluationHash?.slice(0, 12) ?? '-'}…`);
  console.log(`evaluation: ${verdict}${entryNote ? `; entry: ${entryNote}` : ''}`);
  if (evaluation) console.log(`checkpoints: registry #${evaluation.checkpoint.registry?.number ?? '-'}, observation #${evaluation.checkpoint.observation?.number ?? '-'}, listing #${evaluation.checkpoint.listing?.number ?? '-'}; evaluated at ${evaluation.evaluatedAt}`);
  console.log(`wrote ${path.join(values.out, 'allowlist.json')} (${ALLOWLIST_SCHEMA}), evaluation.json, inputs.json`);
  process.exitCode = allowed ? 0 : 1;
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 2; });
