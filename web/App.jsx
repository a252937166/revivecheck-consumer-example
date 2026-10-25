// The Token eligibility demo: a separately built, project-controlled example application.
// Anyone who opens it can check the configured token, inspect the exact evidence in the
// ReviveCheck App, correct the entry and refresh, and watch the token selector obey the
// result. Everything is read-only; no login, invitation, wallet or approval is needed.
//
// Facts kept apart on this page: the CURRENT decision (one authoritative state from
// revivecheck/current, fed by this consumer's own evaluator), the LAST VERIFIED result in
// this browser, the RECORDED snapshot committed with the repository, and RECORDED STATES
// replayed from captured reads, which carry a persistent label and never enable anything.
// A current permission ends at the deadline its own evidence sets (the report's age limit
// or the earliest read's freshness limit); the page checks that deadline against the clock
// on every render, at the deadline itself, and again inside the Continue handler.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import config from '../config/allowlist.json';
import recordedRun from '../out/allowlist.json';
import validR2 from '../fixtures/valid-r2.json';
import supersededR1 from '../fixtures/superseded-r1.json';
import revokedR2 from '../fixtures/revoked-r2.json';
import unavailable from '../fixtures/unavailable.json';
import { initialDecision, beginCheck, settleCheck, failCheck, changeSelection, ageDecision, checkPermission, describeDecision, CURRENT_WORDS, VALIDITY_LIMITS } from 'revivecheck/current';
import { explainReason, evidenceExpiry, RENEWAL_STEPS, decisionSheetHtml } from 'revivecheck/decision';
import { entryDecision, canonicalEntry } from 'revivecheck/entry';
import { loadConfig, runFixture, runLive, decide } from '../src/evaluate.js';
import { decisionEvidenceFor } from '../src/decision-evidence.js';
import { selectorOptions, proceedNow } from '../src/selector.js';

loadConfig(config, 'config/allowlist.json');
const APP = 'https://revivecheck.axiqo.xyz/';
const SOURCE = 'https://github.com/a252937166/revivecheck-consumer-example';
const EXPLORER = 'https://scanner-testnet-v3.portaldot.dev';
const TIMEOUT_MS = 90_000;
const REPORT_LINK = `${APP}?report=${config.release.reportHash}#/review`;
const STORAGE_LINK = `${EXPLORER}/#/extrinsics/${config.release.storage.extrinsicHash}`;
const CATALOG_LINK = `${APP}#/app/catalog/testnet-v2`;
// The demonstration starts from a deliberately wrong entry: eighteen decimals, the Ethereum default, where the chain reports six.
const WRONG_ENTRY = { ...config.entry, decimals: 18 };
const FIXTURES = [
  { id: 'valid-r2', fixture: validR2, title: 'Approved revision 2, listed', note: 'Captured after the reviewer approved revision 2 again (step 12 of the recorded lifecycle).' },
  { id: 'superseded-r1', fixture: supersededR1, title: 'Revision superseded', note: 'The binding names revision 1 while the registry already holds revision 2 (step 7).' },
  { id: 'revoked-r2', fixture: revokedR2, title: 'Approval revoked', note: 'The trusted reviewer requested changes on revision 2 (step 11).' },
  { id: 'unavailable', fixture: unavailable, title: 'Node unavailable', note: 'Every read replaced by an error: unknown, never a pass.' },
  { id: 'expired', fixture: validR2, now: '2026-11-02T09:43:18.329Z', title: 'Evidence expired', note: 'The same reads evaluated eight days later: the policy clock, not a chain event, withholds the entry.' },
];
const when = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }).format(date)} UTC`; };
const span = (seconds) => !Number.isFinite(seconds) ? '—' : Math.abs(seconds) >= 86400 ? `${(seconds / 86400).toFixed(1)} days` : Math.abs(seconds) >= 3600 ? `${(seconds / 3600).toFixed(1)} hours` : `${Math.round(seconds)} s`;
const short = (value, keep = 10) => { const text = String(value ?? ''); return text.length > keep * 2 + 1 ? `${text.slice(0, keep)}…${text.slice(-keep)}` : text; };
const download = (blob, filename) => { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
const STATE_TONE = { valid: 'pass', 'recheck-required': 'fail', expired: 'fail', unknown: 'unknown', checking: 'busy', 'not-checked': 'idle' };
const LIMIT_WORDS = { report: "the report's age limit", observation: 'the network read', registry: 'the registry read', listing: 'the listing read' };

function Copy({ value, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* clipboard unavailable: the value is selectable text */ } }
  return <button type="button" className="copy" onClick={copy} aria-label={`${label}: ${value}`}>{done ? 'Copied' : label}</button>;
}
const Identity = ({ value, keep = 12 }) => <span className="identity"><code title={value}>{short(value, keep)}</code><Copy value={value}/></span>;

function Reasons({ codes, observed = {} }) {
  if (!codes.length) return <p className="ok">Every policy condition held and the entry equals the approved report.</p>;
  return <ol className="reasons">{codes.map((code) => { const reason = explainReason(code, { observed: observed[code] ?? null }); return <li key={code}><code>{code}</code> {reason.text}{reason.observed ? <span className="observed"> Observed: {reason.observed}.</span> : null}<span className="recovery"><b>Who acts:</b> {reason.who}. <b>Then:</b> {reason.then}</span></li>; })}</ol>;
}

/** A decision from the evaluator, rendered the same way for the live result and for a recorded replay. */
function DecisionBody({ decision: result, entry, report, label }) {
  const { evaluation, allowlist } = result;
  const expiry = report ? evidenceExpiry(report, config.policy, evaluation?.evaluatedAt ?? new Date()) : null;
  const observed = evaluation ? Object.fromEntries(evaluation.checks.filter((check) => check.status !== 'passed').flatMap((check) => evaluation.reasons.filter((reason) => check.id.split('.')[0] === reason.code.split('-')[0]).map((reason) => [reason.code, check.observed]))) : {};
  const codes = allowlist.denied[0]?.reasons ?? [];
  const observation = evaluation?.checks.find((check) => check.id === 'observation.fresh');
  return <div className="decision-body">
    {label}
    <Reasons codes={codes} observed={observed}/>
    <dl className="facts">
      <div><dt>Entry</dt><dd>{entry.match ? <>equals the approved report <Identity value={entry.reportHash} keep={8}/></> : entry.approved ? <>differs in <b>{entry.mismatches.map((item) => `${item.field} (configured ${item.configured}, approved ${item.approved})`).join('; ')}</b></> : entry.reason}</dd></div>
      <div><dt>Evaluated</dt><dd>{evaluation ? <>{when(evaluation.evaluatedAt)} · status <b>{CURRENT_WORDS[evaluation.status]}</b> · evaluation <Identity value={evaluation.evaluationHash} keep={8}/></> : 'no evaluation: the bound report was not retrieved'}</dd></div>
      <div><dt>Checkpoints</dt><dd>registry #{evaluation?.checkpoint.registry?.number ?? '—'} · listing #{evaluation?.checkpoint.listing?.number ?? '—'} · observation #{evaluation?.checkpoint.observation?.number ?? '—'} · report #{report?.binding?.checkpoint?.number ?? '—'}{allowlist.checkpoints.storage ? <> · stored in #{allowlist.checkpoints.storage.blockNumber}</> : null}</dd></div>
      <div><dt>Evidence age</dt><dd>{expiry?.expiresAt ? <>report sealed {when(expiry.completedAt)}; acceptable until <b>{when(expiry.expiresAt)}</b> ({expiry.expired ? 'expired at this evaluation' : `${span(expiry.secondsLeft)} left at this evaluation`}); a fresh registry read does not renew it</> : 'no bound report'}</dd></div>
      <div><dt>Observation</dt><dd>{observation ? `${observation.observed}; the policy accepts at most ${config.policy.evidence.maxObservationAgeSeconds} s` : 'no fresh network observation'}</dd></div>
      <div><dt>Next action</dt><dd>{allowlist.denied[0]?.nextAction ?? evaluation?.nextAction ?? '—'}</dd></div>
    </dl>
  </div>;
}

export default function App() {
  const [entry, setEntry] = useState(WRONG_ENTRY);
  const selection = useMemo(() => ({ mode: 'live', entry: canonicalEntry(entry) }), [entry]);
  const [decision, setDecision] = useState(() => initialDecision({ selection, recorded: recordedRun }));
  const decisionRef = useRef(decision);
  decisionRef.current = decision;
  const [phase, setPhase] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [chosen, setChosen] = useState('native');
  const [replay, setReplay] = useState(null);
  const [qr, setQr] = useState({});
  const [now, setNow] = useState(() => new Date());
  const [refused, setRefused] = useState('');
  useEffect(() => { setDecision((current) => changeSelection(current, selection)); setRefused(''); }, [selection]);
  // The clock the page renders with: every fifteen seconds, when the tab comes back, and at the deadline itself.
  useEffect(() => {
    const tick = () => { const at = new Date(); setNow(at); setDecision((current) => ageDecision(current, { now: at })); };
    const timer = setInterval(tick, 15_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const lapsesAt = decision.current?.validity?.lapsesAt ?? null;
  useEffect(() => {
    const until = Date.parse(lapsesAt);
    if (!Number.isFinite(until)) return undefined;
    const timer = setTimeout(() => { const at = new Date(); setNow(at); setDecision((current) => ageDecision(current, { now: at })); }, Math.min(Math.max(0, until - Date.now() + 1), 2_147_483_647));
    return () => clearTimeout(timer);
  }, [lapsesAt]);
  useEffect(() => {
    if (decision.state !== 'checking') { setElapsed(0); return undefined; }
    const started = Date.parse(decision.startedAt);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [decision.state, decision.startedAt]);
  useEffect(() => {
    let alive = true;
    Promise.all([REPORT_LINK, STORAGE_LINK].map((url) => QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 168, color: { dark: '#0b0c0f', light: '#ffffff' } }).then((svg) => [url, svg])))
      .then((pairs) => { if (alive) setQr(Object.fromEntries(pairs)); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  async function checkToken() {
    const begun = beginCheck(decisionRef.current, { selection });
    setDecision(begun);
    const request = begun.request;
    setPhase('Loading the verification service…');
    try {
      const work = (async () => {
        const service = await import('revivecheck/service');
        const run = await runLive(config, { service, retries: 1, onPhase: (step) => setPhase(step.text) });
        const result = decide(config, run, { entry });
        if (!result.evaluation) throw new Error(`The bound report could not be retrieved from the chain: ${run.attempts.map((attempt) => attempt.failure || attempt.failedReads?.join('; ')).filter(Boolean).join(' ') || 'no answer'}`);
        return { run, result };
      })();
      const timeout = new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(`No answer within ${TIMEOUT_MS / 1000} s. The public nodes can be slow; read again.`), { kind: 'timeout' })), TIMEOUT_MS));
      const { run, result } = await Promise.race([work, timeout]);
      setNow(new Date());
      setDecision((current) => settleCheck(current, { request, selection, evaluation: result.evaluation, entry: entryDecision(entry, run.report), inputs: run.inputs, policy: config.policy, report: run.report, extra: { allowlist: result.allowlist, run, result } }));
    } catch (error) {
      setDecision((current) => failCheck(current, { request, selection, error, kind: error?.kind === 'timeout' ? 'timeout' : 'error' }));
    } finally { setPhase(''); }
  }
  function downloadEvidence(kind) {
    const { run, result } = decision.current.extra;
    const document_ = decisionEvidenceFor({ config, run, decision: result, producer: { interface: 'Token eligibility demo (browser)' } });
    if (!document_) return;
    const stamp = document_.evaluatedAt.replace(/[:.]/g, '-');
    if (kind === 'json') download(new Blob([JSON.stringify(document_, null, 2)], { type: 'application/json' }), `decision-evidence-${stamp}.json`);
    else download(new Blob([decisionSheetHtml(document_, { qrSvgs: qr })], { type: 'text/html' }), `decision-evidence-${stamp}.html`);
  }
  function replayFixture(item) {
    const run = runFixture(config, item.fixture, { now: item.now, name: item.id });
    const result = decide(config, run, { entry });
    setReplay({ id: item.id, title: item.title, note: item.note, run, result, entry: entryDecision(entry, run.report) });
  }

  /** The business action checks the clock itself; the screen's state is not consulted. */
  function continueWith() {
    const check = proceedNow(decisionRef.current, { subject: config.entry, chosen, now: new Date() });
    if (!check.ok) { setRefused(`Refused at ${when(new Date())}: ${check.reason}`); setNow(new Date()); setDecision((current) => ageDecision(current, { now: new Date() })); return; }
    setRefused('');
    alert(`Continuing with ${check.option.label}. Permission verified at ${new Date().toISOString()}${check.option.validUntil ? `, valid until ${check.option.validUntil}` : ''}. This example stops here: it is a token-admission demonstration, not an exchange.`);
  }
  const permission = checkPermission(decision, { now });
  const described = describeDecision(decision, { subject: 'the configured entry', now });
  const options = selectorOptions(decision, { subject: config.entry, now });
  const proceed = options.find((option) => option.id === chosen)?.selectable === true;
  const tone = permission.reason === 'lapsed' ? 'fail' : permission.allowed ? 'pass' : STATE_TONE[decision.state] || 'idle';
  const current = decision.current && permission.reason !== 'lapsed' ? decision.current : null;
  const wrong = canonicalEntry(entry).decimals !== config.entry.decimals || entry.symbol !== config.entry.symbol || entry.name !== config.entry.name;
  const buttonWord = decision.state === 'checking' ? 'Checking…' : decision.error ? 'Retry the check' : decision.current ? 'Refresh status' : 'Check token';

  return <>
    <header className="top">
      <div>
        <h1>Token eligibility demo</h1>
        <p className="lede">A separately built example application that uses <a href={APP} target="_blank" rel="noreferrer">ReviveCheck</a>. It installs the packed library, owns its policy, retrieves the exact approved report from the Portaldot V3 testnet, and lets its token selector obey the result. Read-only: no login, no wallet, nothing signed.</p>
      </div>
      <nav aria-label="Links"><a href={CATALOG_LINK} target="_blank" rel="noreferrer">ReviveCheck App</a><a href={SOURCE} target="_blank" rel="noreferrer">Source</a><a href={REPORT_LINK} target="_blank" rel="noreferrer">Exact report</a></nav>
    </header>
    <main className="layout">
      <div className="column">
        <section className="block" aria-labelledby="entry-title">
          <h2 id="entry-title">1 · The entry this application wants to publish</h2>
          <p className="muted">This example starts from a deliberately wrong entry: eighteen decimals, the Ethereum default, where the approved report verified six. Correct it below, then check again; a corrected field causes a new evaluation.</p>
          <form className="entry-form" onSubmit={(event) => { event.preventDefault(); checkToken(); }}>
            <label>Symbol<input value={entry.symbol} maxLength={64} onChange={(event) => setEntry({ ...entry, symbol: event.target.value })}/></label>
            <label>Name<input value={entry.name} maxLength={64} onChange={(event) => setEntry({ ...entry, name: event.target.value })}/></label>
            <label>Decimals<input type="number" min="0" max="255" inputMode="numeric" value={entry.decimals} onChange={(event) => setEntry({ ...entry, decimals: event.target.value === '' ? '' : Number(event.target.value) })}/></label>
            <div className="fixed"><span>chain <code>{config.entry.chainId}</code></span><span>asset <code>{config.entry.assetId}</code></span><span>address <Identity value={config.entry.address} keep={10}/></span></div>
            {wrong ? <p className="hint fail">The configured entry differs from the approved report: a check will withhold it and name the field.</p> : <p className="hint pass">The configured entry equals the approved report's values: a check can allow it if the policy holds.</p>}
            <button type="button" className="ghost" onClick={() => setEntry({ ...config.entry })} disabled={!wrong}>Correct to the approved values</button>
          </form>
        </section>

        <section className={`block decision ${tone}`} aria-labelledby="decision-title" aria-live="polite">
          <h2 id="decision-title">2 · Current decision</h2>
          <p className="verdict">{described.headline}</p>
          <p className="state"><span className={`pill ${tone}`}>Current: {described.word}</span>{current && <span className={`pill ${current.entry.match ? 'pass' : 'fail'}`}>{current.entry.match ? 'Entry equals the approved report' : `Entry differs: ${current.entry.mismatches.map((item) => item.field).join(', ')}`}</span>}</p>
          <p className="detail">{described.detail}</p>
          {permission.allowed && <p className="deadline"><b>Permission ends {when(permission.validUntil)}</b> ({LIMIT_WORDS[permission.limitedBy]}; {span(permission.secondsLeft)} left at {when(now)}). Derived from the report's age and each read's time under this policy, checked against the clock on every render and again before the action.<br/><small>{VALIDITY_LIMITS.map((kind) => decision.current.validity.deadlines[kind] ? `${kind}: ${when(decision.current.validity.deadlines[kind].until)}` : `${kind}: not required`).join(' · ')}</small></p>}
          <div className="actions">
            <button type="button" className="primary" onClick={checkToken} disabled={decision.state === 'checking'}>{buttonWord}</button>
            <a className="button" href={REPORT_LINK} target="_blank" rel="noreferrer">Inspect evidence in ReviveCheck</a>
            {current && <><button type="button" onClick={() => downloadEvidence('json')}>Download decision evidence (JSON)</button><button type="button" onClick={() => downloadEvidence('html')}>Decision sheet (HTML)</button></>}
          </div>
          {decision.state === 'checking' && <p className="progress" role="status"><span className="spinner" aria-hidden="true"/>{phase || 'Working…'} {elapsed ? `· ${elapsed} s` : ''}{elapsed > 8 ? ' · the public node can take up to a minute on first contact' : ''}{elapsed > 60 ? ` · gives up at ${TIMEOUT_MS / 1000} s` : ''}</p>}
          {decision.error && <p className="error" role="alert"><b>Nothing was decided.</b> {decision.error.message} The recorded states below replay captured reads and are labelled as such.</p>}
          {current && <DecisionBody decision={current.extra.result} entry={current.entry} report={current.extra.run.report} label={<p className="label live">Live reads · {current.extra.run.source} · evaluated in this browser</p>}/>}
          {decision.current && permission.reason === 'lapsed' && <p className="muted">The lapsed answer was <b>{CURRENT_WORDS[decision.current.status]}</b>, evaluated at {when(decision.current.evaluatedAt)}; its permission ended at {when(decision.current.validity.validUntil ?? decision.current.validity.lapsesAt)}. It stays visible as what it was and permits nothing now.</p>}
          <div className="history">
            <div><h3>Last verified in this browser</h3>{decision.lastVerified ? <p>{when(decision.lastVerified.evaluatedAt)} · registry #{decision.lastVerified.checkpoint?.registry?.number} · evaluation <Identity value={decision.lastVerified.evaluationHash} keep={8}/> · permitted until {when(decision.lastVerified.validUntil)}<br/><small>History: a past valid result is not a current permission.</small></p> : <p className="muted">No valid result yet in this browser.</p>}</div>
            <div><h3>Recorded snapshot</h3><p><span className={`pill ${recordedRun.allow.length ? 'pass' : 'fail'}`}>{recordedRun.allow.length ? 'allowed' : 'denied'}</span> {when(recordedRun.generatedAt)} · {recordedRun.source} · evaluation <Identity value={recordedRun.evaluationHash} keep={8}/><br/><small>The one live run committed with this repository on 2026-10-25. Evidence of what held then, not a permission now.</small></p></div>
          </div>
        </section>

        <section className="block" aria-labelledby="selector-title">
          <h2 id="selector-title">3 · The business action: choose a token</h2>
          <p className="muted">The selector reads the allow-list the evaluator produced. The configured token is selectable only while the current decision is valid, its entry equals the approved report and its deadline has not passed. Continue checks the clock again at the moment it is pressed; no flag is set by hand.</p>
          <div className="selector">
            <label>Pay with<select value={chosen} onChange={(event) => setChosen(event.target.value)}>{options.map((option) => <option key={option.id} value={option.id} disabled={!option.selectable}>{option.label}</option>)}</select></label>
            <button type="button" className="primary" disabled={!proceed} onClick={continueWith}>Continue</button>
          </div>
          {refused && <p className="error" role="alert"><b>Not continued.</b> {refused}</p>}
          <ul className="option-list">{options.map((option) => <li key={option.id}><span className={`pill ${option.selectable ? 'pass' : 'fail'}`}>{option.selectable ? 'selectable' : 'not selectable'}</span> <b>{option.label}</b><br/><small>{option.reason}</small></li>)}</ul>
        </section>

        <section className="block" aria-labelledby="recorded-title">
          <h2 id="recorded-title">4 · Recorded states, replayed through the same logic</h2>
          <p className="muted">Reads captured live on the testnet on 2026-10-25, evaluated here under this application's policy with the entry configured above. They explain why the token becomes unavailable and what restores it. A recorded state never enables the selector.</p>
          <div className="chips">{FIXTURES.map((item) => <button type="button" key={item.id} className={replay?.id === item.id ? 'chip on' : 'chip'} onClick={() => replayFixture(item)}>{item.title}</button>)}</div>
          {replay && <div className={`replay ${replay.result.allowed ? 'pass' : 'fail'}`}>
            <p className="label recorded">RECORDED · {replay.title} · captured {when(replay.run.fixture.capturedAt)}{replay.run.fixture.clockOverride ? ` · clock set to ${when(replay.run.fixture.clockOverride)}` : ''} · fixture <code>{replay.id}</code></p>
            <p className="verdict small">{replay.result.allowed ? 'Would have been available' : 'Withheld'}</p>
            <p className="muted">{replay.note} Provenance: {replay.run.fixture.provenance?.file ?? replay.run.fixture.provenance?.source}.</p>
            <DecisionBody decision={replay.result} entry={replay.entry} report={replay.run.report} label={null}/>
          </div>}
        </section>
      </div>

      <aside className="column side">
        <section className="block" aria-labelledby="policy-title">
          <h2 id="policy-title">This application's policy</h2>
          <dl className="facts">
            <div><dt>Name</dt><dd>{config.policy.name}</dd></div>
            <div><dt>Policy hash</dt><dd><Identity value={decision.current?.extra?.result?.policyHash ?? recordedRun.policyHash} keep={10}/></dd></div>
            <div><dt>Network</dt><dd>{config.policy.network.key} · chain {config.policy.network.chainId} · runtime {config.policy.runtime.specName}/{config.policy.runtime.specVersions.join(', ')}</dd></div>
            <div><dt>Evidence</dt><dd>report at most {span(config.policy.evidence.maxAgeSeconds)} old · reads at most {config.policy.evidence.maxObservationAgeSeconds} s old · both interfaces must agree · the report must be stored on-chain</dd></div>
            <div><dt>Trusted reviewer</dt><dd>{config.policy.reviewers.trusted.map((address) => <Identity key={address} value={address} keep={10}/>)}<br/><small>{config.policy.reviewers.basis}</small></dd></div>
            <div><dt>Consumer contract</dt><dd>VerifiedTokenList v{config.policy.consumer.version} <Identity value={config.policy.consumer.address} keep={10}/></dd></div>
          </dl>
        </section>
        <section className="block" aria-labelledby="release-title">
          <h2 id="release-title">The release and its evidence</h2>
          <dl className="facts">
            <div><dt>Release</dt><dd>{config.release.label} · revision {config.release.revision} · owner <Identity value={config.release.owner} keep={8}/><br/><Identity value={config.release.releaseId} keep={10}/></dd></div>
            <div><dt>Exact report</dt><dd><Identity value={config.release.reportHash} keep={10}/></dd></div>
            <div><dt>Stored on-chain</dt><dd>extrinsic <Identity value={config.release.storage.extrinsicHash} keep={8}/> in block <Identity value={config.release.storage.blockHash} keep={8}/></dd></div>
          </dl>
          <div className="qrs">
            <figure><div className="qr" dangerouslySetInnerHTML={{ __html: qr[REPORT_LINK] || '' }}/><figcaption><a href={REPORT_LINK} target="_blank" rel="noreferrer">The exact report in the ReviveCheck App</a></figcaption></figure>
            <figure><div className="qr" dangerouslySetInnerHTML={{ __html: qr[STORAGE_LINK] || '' }}/><figcaption><a href={STORAGE_LINK} target="_blank" rel="noreferrer">The stored report on the official explorer</a></figcaption></figure>
          </div>
        </section>
        <section className="block" aria-labelledby="renewal-title">
          <h2 id="renewal-title">When the evidence expires</h2>
          <p className="muted">The bound report is acceptable under this policy until <b>{when(evidenceExpiry(validR2.report, config.policy).expiresAt)}</b>. Refreshing the registry does not renew it; the sequence below does, role by role.</p>
          <ol className="steps">{RENEWAL_STEPS.map((step) => <li key={step.step}><b>{step.role}</b>: {step.action}</li>)}</ol>
        </section>
        <section className="block" aria-labelledby="about-title">
          <h2 id="about-title">What this shows, and what it does not</h2>
          <p>It shows a second application consuming ReviveCheck's documented interfaces from the packed artifact, making its own decision, and letting a real control obey it. It does not show independent adoption: this example was built by the ReviveCheck project, and the release owner and the trusted reviewer are both project-controlled test accounts, so the on-chain record shows role separation, not independent review.</p>
          <p><small>Roles: owner, {config.roles.owner.control}; reviewer, {config.roles.reviewer.control}; operator, {config.roles.operator.control}.</small></p>
        </section>
      </aside>
    </main>
    <footer className="foot"><span>Portaldot V3 testnet · {config.policy.network.genesisHash.slice(0, 14)}…</span><a href={SOURCE} target="_blank" rel="noreferrer">Source and CI</a><a href={APP} target="_blank" rel="noreferrer">ReviveCheck</a></footer>
  </>;
}
