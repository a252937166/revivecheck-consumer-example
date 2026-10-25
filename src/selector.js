// The token selector consumes the evaluator's output, not a decorative flag: an option
// is selectable only when it appears in `allowlist.allow`, which the allow-list builds
// only from a `valid` evaluation whose configured entry equals the approved report. The
// current decision (`revivecheck/current`) says whether that output still permits
// anything AT THE CLOCK IT IS HANDED: a result lapses at the deadline its own evidence
// sets (the report's age limit or the earliest read's freshness limit), so the options
// are derived with `now`, and the business action re-derives them at the moment it
// acts (`proceedNow`) instead of trusting a flag a timer set earlier. Pure, so it is
// tested without a browser.
import { checkPermission } from 'revivecheck/current';

export const NATIVE_OPTION = Object.freeze({ id: 'native', label: 'tPOT (native, not subject to this policy)', selectable: true, reason: 'The native token is not an allow-listed entry; it is here so the control has one option that never depends on the policy.' });
const LIMIT_WORDS = { report: "the report's age limit", observation: 'the network read', registry: 'the registry read', listing: 'the listing read' };

/** The options the selector offers at `now`, derived from the current decision's allow-list output. */
export function selectorOptions(decision, { subject, now = new Date() }) {
  const allowlist = decision.current?.extra?.allowlist ?? null;
  const permission = checkPermission(decision, { now });
  const allowed = permission.allowed && allowlist ? allowlist.allow.find((entry) => entry.address === subject.address.toLowerCase()) : null;
  const denied = allowlist?.denied?.find((entry) => entry.address === subject.address.toLowerCase()) ?? null;
  const why = allowed ? `Allowed by evaluation ${allowlist.evaluationHash.slice(0, 12)}… at ${allowlist.evaluatedAt}; entry from the approved report ${allowed.reportHash.slice(0, 12)}…, revision ${allowed.revision}. Permission ends ${permission.validUntil} (${LIMIT_WORDS[permission.limitedBy]}).`
    : permission.reason === 'not-checked' ? 'Not checked yet: nothing permits this entry.'
      : permission.reason === 'checking' ? 'Checking: permission is withdrawn until a fresh result arrives.'
        : permission.reason === 'lapsed' ? `Lapsed: the permission of the last result ended at ${permission.validUntil} (${LIMIT_WORDS[permission.limitedBy]}); refresh before selecting.`
          : permission.reason === 'failed' ? `The check failed (${decision.error?.kind ?? 'error'}); unavailable verification never enables anything.`
            : permission.reason === 'validity-unknown' ? 'Withheld: the deadline of the evidence could not be derived, so nothing permits this entry.'
              : denied ? `Withheld: ${denied.reasons.join(', ')}.` : 'Withheld.';
  return [
    { id: subject.address.toLowerCase(), label: allowed ? `${allowed.symbol} · ${allowed.name} · ${allowed.decimals} decimals` : `${subject.symbol} (withheld)`, selectable: !!allowed, reason: why, entry: allowed ?? null, validUntil: allowed ? permission.validUntil : null },
    NATIVE_OPTION,
  ];
}

/** Whether a chosen option may proceed, given options derived for the moment of acting. */
export function canProceed(options, chosen) {
  const option = options.find((item) => item.id === chosen);
  return !!option && option.selectable === true;
}

/**
 * The business action's own check: re-derive the options from the current decision at
 * `now` and decide. A timer-updated screen is not consulted; the clock is. Returns the
 * option when it may proceed, otherwise the reason it may not.
 */
export function proceedNow(decision, { subject, chosen, now = new Date() }) {
  const options = selectorOptions(decision, { subject, now });
  const option = options.find((item) => item.id === chosen) ?? null;
  const ok = !!option && option.selectable === true;
  return { ok, option, options, reason: ok ? null : option ? option.reason : 'No such option.', permission: checkPermission(decision, { now }) };
}
