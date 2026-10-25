#!/usr/bin/env node
// Derive this repository's offline fixtures from the raw reads the upstream ReviveCheck
// example catalog captured live on 2026-10-25 (examples/token-catalog/data/testnet-v2/
// captures/*.inputs.json in the ReviveCheck checkout). Those files are not part of the
// npm package, so they are copied here once, with provenance, by this script.
//
// What is reused: only the raw reads (network observation, registry read, consumer
// listing, stored-evidence retrieval with the sealed report it returned). The upstream
// capture wrapper (`revivecheck.token-catalog-inputs.v1`) carries the example catalog's
// policy hash; that hash is recorded as provenance and is NOT used for anything. This
// consumer evaluates the raw reads under its own policy with a binding it creates
// itself, which is what `evaluateBinding` accepts.
//
//   node scripts/import-capture.js --source <ReviveCheck checkout> [--out fixtures]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const SUBJECT = '0x00001e6100000000000000000000000000010000';
const CAPTURES = 'examples/token-catalog/data/testnet-v2/captures';
export const FIXTURE_SCHEMA = 'revivecheck-consumer.fixture.v1';

const IMPORTS = [
  {
    name: 'valid-r2', capture: '12-reapprove-r2.inputs.json', revision: '2', expect: 'valid',
    description: 'Revision 2 of pusd-catalog-v2 approved by the trusted reviewer, listed on the v2 VerifiedTokenList, report 1faef921… stored on-chain. Expected: valid, entry allowed.',
  },
  {
    name: 'superseded-r1', capture: '07-submit-r2.inputs.json', revision: '1', expect: 'recheck-required',
    description: 'The registry already holds revision 2 (1faef921…) while this binding still names revision 1 (eb960cc7…), whose report is the one retrieved from chain. Expected: recheck-required with revision-superseded.',
  },
  {
    name: 'revoked-r2', capture: '11-revoke-r2.inputs.json', revision: '2', expect: 'recheck-required',
    description: 'Revision 2 bound and stored, but the trusted reviewer has requested changes (reviewed, not approved). Expected: recheck-required with approval-revoked.',
  },
];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function fixtureFromCapture({ file, text, revision, name, description, expect }) {
  const capture = JSON.parse(text);
  if (capture.schema !== 'revivecheck.token-catalog-inputs.v1') throw new Error(`${file} is not an upstream capture.`);
  const token = capture.tokens?.[SUBJECT];
  if (!token) throw new Error(`${file} has no reads for ${SUBJECT}.`);
  const { observation, registry, listing, evidence } = token;
  const report = evidence?.run;
  if (!report?.evidenceHash) throw new Error(`${file} carries no retrieved report.`);
  return {
    schema: FIXTURE_SCHEMA,
    name,
    description,
    expect,
    provenance: {
      source: 'ReviveCheck example token catalog, live capture on the Portaldot V3 testnet',
      file: `${CAPTURES}/${file}`,
      sha256: sha256(text),
      capturedAt: capture.capturedAt,
      upstreamSchema: capture.schema,
      upstreamConfig: capture.config,
      upstreamPolicyHash: capture.policyHash,
      note: 'Only the raw reads are reused. The upstream policy hash is recorded here for traceability and is not used by this consumer, which evaluates under its own policy and binding.',
    },
    now: capture.now,
    binding: {
      releaseId: registry.releaseId,
      revision,
      reportHash: report.evidenceHash,
      storage: { extrinsicHash: evidence.extrinsicHash, blockHash: evidence.blockHash },
    },
    report,
    inputs: { observation, registry, listing, evidence },
  };
}

/** The outage fixture: the same sealed report, every read replaced by an error. */
export function unavailableFrom(valid) {
  const error = 'fixture: the public node did not answer (simulated outage)';
  return {
    schema: FIXTURE_SCHEMA,
    name: 'unavailable',
    description: 'Every live read failed; the report is known but nothing about the network, the registry, the listing or the stored evidence could be read. Expected: unknown, denied. An unavailable verification never enables anything.',
    expect: 'unknown',
    provenance: { source: 'derived from valid-r2.json by replacing every read with an error object', derivedFrom: valid.provenance.file, note: 'The sealed report is unchanged so that a binding can still be created; only the reads fail.' },
    now: valid.now,
    binding: valid.binding,
    report: valid.report,
    inputs: { observation: { error }, registry: { error }, listing: { error }, evidence: { error } },
  };
}

async function main() {
  const { values } = parseArgs({ options: { source: { type: 'string' }, out: { type: 'string', default: 'fixtures' } } });
  if (!values.source) throw new Error('--source names the ReviveCheck checkout that holds the captures.');
  await mkdir(values.out, { recursive: true });
  let valid = null;
  for (const item of IMPORTS) {
    const file = path.join(values.source, CAPTURES, item.capture);
    const text = await readFile(file, 'utf8');
    const fixture = fixtureFromCapture({ file: item.capture, text, ...item });
    const target = path.join(values.out, `${item.name}.json`);
    await writeFile(target, `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`${target}: ${item.capture} (sha256 ${fixture.provenance.sha256.slice(0, 16)}…) binding revision ${item.revision}, report ${fixture.binding.reportHash.slice(0, 12)}…`);
    if (item.name === 'valid-r2') valid = fixture;
  }
  const unavailable = unavailableFrom(valid);
  const target = path.join(values.out, 'unavailable.json');
  await writeFile(target, `${JSON.stringify(unavailable, null, 2)}\n`);
  console.log(`${target}: derived from valid-r2 with every read replaced by an error`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
