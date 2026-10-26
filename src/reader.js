// The loaded-release reader, kept pure so the page and the tests share it (repair handoff
// 2026-10-26, R-06). A release file read back is a DOCUMENT, not a decision: the decision
// is derived from the document and the clock at every render, so an entry whose deadline
// passes while the file is on screen stops being selectable without a re-import.
// Verification (hash, embedded decisions) depends on the document alone and is cached by
// release hash; eligibility ages independently. Without fresh reads the reader applies the
// deadlines only, and says so: a clock is not a chain read, and a revocation after the
// recorded reads is seen by `--live` reads or a new check only.
import { readCatalogRelease, selectorFrom, verifyCatalogRelease } from 'revivecheck/catalog-release';

const verifications = new WeakMap();
/** Verify once per document object; the result cannot change while the bytes do not. */
export function verifiedOnce(release) {
  if (!release || typeof release !== 'object') return verifyCatalogRelease(release);
  if (!verifications.has(release)) verifications.set(release, verifyCatalogRelease(release));
  return verifications.get(release);
}

/** The view of a loaded release at `now`: the read, the selector rows, the earliest deadline still ahead (to wake the page at), and words for the screen. */
export function loadedReleaseView(release, now = new Date()) {
  const at = now instanceof Date ? now : new Date(now);
  const read = readCatalogRelease(release, { now: at });
  const rows = selectorFrom(read);
  const deadlines = (release?.entries || []).map((entry) => Date.parse(entry.validUntil)).filter((time) => Number.isFinite(time) && time >= at.getTime());
  const nextDeadline = deadlines.length ? new Date(Math.min(...deadlines)).toISOString() : null;
  return {
    read, rows, nextDeadline, verification: verifiedOnce(release),
    verdict: read.ok ? 'At least one entry may be used now' : 'Nothing in this file may be used now',
    clockNote: read.freshness === 'deadline-only' ? 'Decided from the document and this clock only: the deadline each entry carries is applied; the chain was not read, so a revocation, a new revision or a delisting since the recorded reads is not detected here.' : 'Decided on fresh reads under the release\'s own policy.',
  };
}
