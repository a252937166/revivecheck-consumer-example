// The token selector consumes the evaluator's output, not a decorative flag: an option
// is selectable only when it appears in `allowlist.allow`, which the allow-list builds
// only from a `valid` evaluation whose configured entry equals the approved report. The
// current decision (`revivecheck/current`) says whether that output is fresh; a lapsed,
// failed or recorded result offers nothing. Pure, so it is tested without a browser.
import { canAct } from 'revivecheck/current';

export const NATIVE_OPTION = Object.freeze({ id: 'native', label: 'tPOT (native, not subject to this policy)', selectable: true, reason: 'The native token is not an allow-listed entry; it is here so the control has one option that never depends on the policy.' });

/** The options the selector offers right now, derived from the current decision's allow-list output. */
export function selectorOptions(decision, { subject }) {
  const allowlist = decision.current?.extra?.allowlist ?? null;
  const fresh = canAct(decision) && allowlist;
  const allowed = fresh ? allowlist.allow.find((entry) => entry.address === subject.address.toLowerCase()) : null;
  const denied = allowlist?.denied?.find((entry) => entry.address === subject.address.toLowerCase()) ?? null;
  const why = allowed ? `Allowed by evaluation ${allowlist.evaluationHash.slice(0, 12)}… at ${allowlist.evaluatedAt}; entry from the approved report ${allowed.reportHash.slice(0, 12)}…, revision ${allowed.revision}.`
    : decision.state === 'not-checked' ? 'Not checked yet: nothing permits this entry.'
      : decision.state === 'checking' ? 'Checking: permission is withdrawn until a fresh result arrives.'
        : decision.stale ? 'The last result is older than the observation limit; refresh before selecting.'
          : decision.error ? `The check failed (${decision.error.kind}); unavailable verification never enables anything.`
            : denied ? `Withheld: ${denied.reasons.join(', ')}.` : 'Withheld.';
  return [
    { id: subject.address.toLowerCase(), label: allowed ? `${allowed.symbol} · ${allowed.name} · ${allowed.decimals} decimals` : `${subject.symbol} (withheld)`, selectable: !!allowed, reason: why, entry: allowed ?? null },
    NATIVE_OPTION,
  ];
}

/** Whether a chosen option may proceed. The subject proceeds only on a selectable option from the current output. */
export function canProceed(options, chosen) {
  const option = options.find((item) => item.id === chosen);
  return !!option && option.selectable === true;
}
