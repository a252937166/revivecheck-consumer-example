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
// approved report and writes out/allowlist.json, out/evaluation.json, out/inputs.json and
// out/decision-evidence.json (the portable document `src/reconstruct.js` re-derives).
// Exit code 0 only when the entry is allowed. Nothing is signed; every read is public.
// The same evaluator (src/evaluate.js) runs in the browser (web/).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { summarizeEvaluation } from 'revivecheck/policy';
import { ALLOWLIST_SCHEMA } from './allowlist.js';
import { loadConfig, runFixture, runLive, decide } from './evaluate.js';
import { decisionEvidenceFor } from './decision-evidence.js';

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

async function main() {
  const config = loadConfig(await readJson(values.config), values.config);
  const retries = Math.min(10, Math.max(1, Number.parseInt(values.retries, 10) || 3));
  const run = values.fixture
    ? runFixture(config, await readJson(values.fixture), { now: values.now, name: path.basename(values.fixture) })
    : await runLive(config, { service: await import('revivecheck/service'), now: values.now, retries, log: (line) => console.error(line) });
  const decision = decide(config, run);
  const { evaluation, allowlist, inputsRecord, allowed, policyHash: hash } = decision;
  const evidence = decisionEvidenceFor({ config, run, decision });
  await mkdir(values.out, { recursive: true });
  await writeFile(path.join(values.out, 'allowlist.json'), `${JSON.stringify(allowlist, null, 2)}\n`);
  await writeFile(path.join(values.out, 'evaluation.json'), `${JSON.stringify(evaluation ?? { schema: null, status: 'unknown', reason: 'no evaluation: the bound report was not retrieved from the chain', attempts: run.attempts, retrieval: run.retrieval }, null, 2)}\n`);
  await writeFile(path.join(values.out, 'inputs.json'), `${JSON.stringify(inputsRecord, null, 2)}\n`);
  if (evidence) await writeFile(path.join(values.out, 'decision-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  const verdict = evaluation ? summarizeEvaluation(evaluation) : 'unknown: the bound report was not retrieved';
  const entryNote = allowlist.denied[0]?.reasons.filter((reason) => reason.startsWith('entry-')).join(', ');
  console.log(`${allowed ? 'ALLOWED' : 'DENIED'} ${allowlist.denied[0]?.address ?? allowlist.allow[0].address} (${run.source})`);
  console.log(`policy ${hash.slice(0, 12)}… binding ${run.binding?.bindingHash?.slice(0, 12) ?? '-'}… evaluation ${evaluation?.evaluationHash?.slice(0, 12) ?? '-'}…`);
  console.log(`evaluation: ${verdict}${entryNote ? `; entry: ${entryNote}` : ''}`);
  if (evaluation) console.log(`checkpoints: registry #${evaluation.checkpoint.registry?.number ?? '-'}, observation #${evaluation.checkpoint.observation?.number ?? '-'}, listing #${evaluation.checkpoint.listing?.number ?? '-'}; evaluated at ${evaluation.evaluatedAt}`);
  console.log(`wrote ${path.join(values.out, 'allowlist.json')} (${ALLOWLIST_SCHEMA}), evaluation.json, inputs.json${evidence ? `, decision-evidence.json (${evidence.schema}, sha256 ${evidence.evidenceHash.slice(0, 12)}…)` : ''}`);
  process.exitCode = allowed ? 0 : 1;
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 2; });
