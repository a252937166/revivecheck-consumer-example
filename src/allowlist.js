// The allow-list rule, implemented here on ReviveCheck's public interfaces only.
//
// An entry is allowed when two things hold at once:
//   1. the policy evaluation of its binding is `valid` (revivecheck/policy decides), and
//   2. the entry this allow-list publishes equals, field by field, the entry the
//      approved report verified through both interfaces.
//
// The published fields (chainId, address, symbol, name, decimals, assetId) are derived
// from the approved report, never copied from the configuration. The configuration says
// what the operator intends to publish; when it differs from what was verified and
// approved, the entry is withheld and the differing field is named. Nothing here reads
// the network: callers hand in the report, the binding and the evaluation.
import { fingerprint, verifyRun } from 'revivecheck/report';

export const ALLOWLIST_SCHEMA = 'revivecheck-consumer.allowlist.v1';
export const CONFIG_SCHEMA = 'revivecheck-consumer.config.v1';
/** Every field the allow-list publishes. All of them must equal the approved report. */
export const ENTRY_FIELDS = Object.freeze(['chainId', 'address', 'symbol', 'name', 'decimals', 'assetId']);
/** The fields the report's `token.listing` check confirms per field through both interfaces. */
const CONFIRMED_FIELDS = Object.freeze(['chainId', 'address', 'symbol', 'name', 'decimals']);
const H160 = /^0x[0-9a-f]{40}$/;
const lower = (value) => String(value ?? '').toLowerCase();

export const ENTRY_NEXT_ACTION = 'Do not enable this entry. Correct the allow-list configuration to the approved values, or check and approve a release that carries the configured values and bind that report explicitly.';
const NO_EVALUATION_NEXT_ACTION = 'Do not enable. No policy evaluation could be made because the bound report was not retrieved from the chain; retry the retrieval. Unavailable verification never counts as valid.';

/** One canonical shape for an entry, so two spellings of the same entry compare equal. */
export function canonicalEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    chainId: Number(entry.chainId),
    address: lower(entry.address),
    symbol: String(entry.symbol ?? ''),
    name: String(entry.name ?? ''),
    decimals: Number(entry.decimals),
    assetId: entry.assetId === undefined || entry.assetId === null ? null : String(entry.assetId),
  };
}

/** The identity of an entry: SHA-256 (ReviveCheck's canonical fingerprint) over its canonical fields. */
export const entryIdentity = (entry) => { const canonical = canonicalEntry(entry); return canonical ? fingerprint(canonical) : null; };

/**
 * The entry an approved report verified: the report's own listing claim, accepted only
 * when the report is intact, passed, and its `token.listing` check confirmed every
 * published field through both interfaces with the same values. Anything else yields
 * no entry, with the reason.
 */
export function approvedEntry(report) {
  if (!verifyRun(report)) return { entry: null, reason: 'the report fails its integrity check' };
  if (report.status !== 'passed') return { entry: null, reason: `the report did not pass (${report.status})` };
  const input = report.input || {};
  if (input.profile !== 'native-asset' || !input.listing || typeof input.listing !== 'object') return { entry: null, reason: 'only a passed native-asset report with a listing claim can approve an entry' };
  const check = (report.checks || []).find((item) => item.id === 'token.listing');
  if (!check || check.status !== 'passed') return { entry: null, reason: 'the report has no passed token.listing check' };
  const fields = Array.isArray(check.evidence?.fields) ? check.evidence.fields : null;
  if (!fields) return { entry: null, reason: 'the token.listing check carries no per-field evidence' };
  const entry = canonicalEntry({ ...input.listing, assetId: input.nativeAsset?.assetId ?? null });
  for (const field of CONFIRMED_FIELDS) {
    const confirmed = fields.find((item) => item.field === field);
    if (!confirmed || confirmed.status !== 'passed') return { entry: null, reason: `the token.listing check did not confirm ${field}` };
    const claimed = field === 'address' ? lower(confirmed.claimed) : field === 'chainId' || field === 'decimals' ? Number(confirmed.claimed) : String(confirmed.claimed);
    if (claimed !== entry[field]) return { entry: null, reason: `the token.listing evidence for ${field} does not match the report's listing claim` };
  }
  if (check.evidence.assetId !== undefined && String(check.evidence.assetId) !== entry.assetId) return { entry: null, reason: 'the token.listing evidence names another asset than the report plan' };
  if (!H160.test(entry.address) || !Number.isSafeInteger(entry.chainId) || !Number.isInteger(entry.decimals) || !entry.symbol || !entry.name || entry.assetId === null) return { entry: null, reason: 'the report listing is incomplete' };
  return { entry, reason: null, reportHash: report.evidenceHash, checkpoint: report.binding?.checkpoint ?? null };
}

/** Field-by-field comparison of the configured entry with the approved one, in canonical form. */
export function compareEntry(configured, approved) {
  const want = canonicalEntry(configured), have = canonicalEntry(approved);
  if (!want) return { match: false, mismatches: [], reason: 'no configured entry' };
  if (!have) return { match: false, mismatches: [], reason: 'no approved entry' };
  const mismatches = ENTRY_FIELDS.filter((field) => want[field] !== have[field]).map((field) => ({ field, configured: want[field], approved: have[field] }));
  return { match: mismatches.length === 0, mismatches, reason: mismatches.length ? `the configured entry differs from the approved report in ${mismatches.map((item) => item.field).join(', ')}` : null };
}

const compactBinding = (binding) => binding ? { id: binding.id, bindingHash: binding.bindingHash, policyHash: binding.policyHash, reportHash: binding.reportHash, releaseId: binding.releaseId, revision: binding.revision, storage: binding.storage, boundBy: binding.boundBy, boundAt: binding.boundAt } : null;

/**
 * The document a DEX would read. `allow` holds the entry only when the evaluation is
 * `valid` and the configured entry is the approved one; otherwise `denied` names the
 * address, every reason code (policy reasons first, then `entry-mismatch:<field>`) and
 * the next action.
 */
export function buildAllowlist({ config, policyHash, binding, evaluation, report, source, retrieval = null, generatedAt = new Date().toISOString() }) {
  const approved = report ? approvedEntry(report) : { entry: null, reason: retrieval?.reasons?.length ? `the bound report was not retrieved from the chain: ${retrieval.reasons.join(' ')}` : 'the bound report was not retrieved' };
  const comparison = compareEntry(config.entry, approved.entry);
  const policyOk = evaluation?.enable === true;
  const allowed = policyOk && comparison.match;
  const policyReasons = evaluation ? evaluation.reasons.map((reason) => reason.code) : ['storage-unverified'];
  const entryReasons = comparison.match ? [] : approved.entry ? comparison.mismatches.map((item) => `entry-mismatch:${item.field}`) : ['entry-unverified'];
  const nextAction = allowed ? evaluation.nextAction : !evaluation ? NO_EVALUATION_NEXT_ACTION : policyOk ? ENTRY_NEXT_ACTION : evaluation.nextAction;
  const subject = lower(config.entry.address);
  return {
    schema: ALLOWLIST_SCHEMA,
    name: config.name,
    source,
    generatedAt,
    network: { key: config.policy.network.key, chainId: config.policy.network.chainId, genesisHash: lower(config.policy.network.genesisHash) },
    allow: allowed ? [{
      ...approved.entry,
      source: 'approved-report',
      reportHash: approved.reportHash,
      reportCheckpoint: approved.checkpoint,
      releaseId: binding.releaseId,
      revision: binding.revision,
      trustedReviewers: evaluation.reasons.length ? [] : config.policy.reviewers.trusted.map(lower),
      identity: entryIdentity(approved.entry),
    }] : [],
    denied: allowed ? [] : [{
      address: subject,
      status: evaluation?.status ?? 'unknown',
      reasons: [...new Set([...policyReasons, ...entryReasons])],
      nextAction,
      entry: {
        configured: canonicalEntry(config.entry),
        approved: approved.entry,
        match: comparison.match,
        mismatches: comparison.mismatches,
        reason: comparison.match ? null : approved.entry ? comparison.reason : approved.reason,
      },
    }],
    evaluatedAt: evaluation?.evaluatedAt ?? null,
    checkpoints: {
      registry: evaluation?.checkpoint?.registry ?? null,
      observation: evaluation?.checkpoint?.observation ?? null,
      listing: evaluation?.checkpoint?.listing ?? null,
      ...(evaluation?.checkpoint && 'subject' in evaluation.checkpoint ? { subject: evaluation.checkpoint.subject ?? null } : {}),
      storage: retrieval && retrieval.verified ? { blockNumber: retrieval.blockNumber ?? null, blockHash: retrieval.blockHash ?? null, extrinsicHash: retrieval.extrinsicHash ?? null, extrinsicIndex: retrieval.extrinsicIndex ?? null } : null,
      report: approved.checkpoint ?? report?.binding?.checkpoint ?? null,
    },
    policyHash,
    policyName: config.policy.name,
    evaluationHash: evaluation?.evaluationHash ?? null,
    evaluationStatus: evaluation?.status ?? null,
    binding: compactBinding(binding),
    reviewerTrust: config.policy.reviewers.basis,
    roles: config.roles,
    rule: 'An entry is allowed only when its binding evaluates to valid under this policy and the published fields equal the approved report field by field. A valid evaluation with a differing configured entry withholds the entry and names the field. The published fields come from the approved report, not from this configuration.',
    caveat: 'An allowed entry means the policy held at the recorded checkpoints and time; evaluate again before each use. The roles above say who controls each account. This allow-list establishes neither independent review nor adoption: both the release owner and the trusted reviewer are controlled by the ReviveCheck project.',
  };
}
