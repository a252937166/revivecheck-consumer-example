#!/usr/bin/env node
// The offline browser journey behind repair handoff 2026-10-26, R-06: the retained live
// release of 2026-10-25 (permission until 19:05:17.293Z) is loaded into the page's reader
// under a controlled browser clock just before its deadline, shows its entry selectable,
// and becomes unavailable without a re-import when the clock crosses the deadline, when the
// tab comes back after it, and for a tampered or malformed file. The live decision control
// stays "Not checked" throughout: the reader grants nothing to it. No network is used.
//
// Harness (follow-up of 2026-10-26): every CLI command is bounded, so a browser operation
// that never returns ends the journey with a named failure and the observations so far;
// each clock scenario runs in a fresh browser context with one clock installation (no
// `pauseAt`, which had stalled indefinitely); only this session's browser is ever closed.
//
//   node test/browser/reader-expiry-journey.mjs [--site http://127.0.0.1:4191/] [--session reader] [--out <file>]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const SITE = option('--site', 'http://127.0.0.1:4191/').replace(/\/?$/, '/');
const SESSION = option('--session', 'reader');
const OUT = option('--out', null);
// Every CLI command is bounded: one that never returns (a stuck browser operation) ends the journey with a named failure and the observations so far.
const CLI_TIMEOUT_MS = 120_000;
const RELEASE_FILE = path.join(root, 'out/releases/catalog-release-1.json');
const release = JSON.parse(readFileSync(RELEASE_FILE, 'utf8'));
const DEADLINE = release.validity.validUntil;
const BEFORE = new Date(Date.parse(DEADLINE) - 60_000).toISOString();
const observations = [];
const contexts = [];
const scratch = mkdtempSync(path.join(tmpdir(), 'consumer-reader-'));
function cli(...parts) {
  const result = spawnSync('playwright-cli', ['-s', SESSION, ...parts], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: CLI_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (result.error) throw new Error(`playwright-cli ${parts[0]} ${result.error.code === 'ETIMEDOUT' ? `did not return within ${CLI_TIMEOUT_MS / 1000} s and was killed` : `could not run: ${result.error.message}`}`);
  if (result.status !== 0) throw new Error(`playwright-cli ${parts[0]} failed: ${(result.stderr || result.stdout).slice(0, 600)}`);
  return result.stdout;
}
const closeSession = () => spawnSync('playwright-cli', ['-s', SESSION, 'close'], { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
const evaluate = (js) => { const out = cli('--raw', 'eval', js).trim(); try { return JSON.parse(out); } catch { return out; } };
const json = (js) => JSON.parse(evaluate(`JSON.stringify((() => { ${js} })())`) || 'null');
async function waitFor(label, js, timeoutMs = 30_000) { const started = Date.now(); for (;;) { const value = json(js); if (value) return value; if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`); await new Promise((resolve) => setTimeout(resolve, 500)); } }
function runCode(body) { const file = path.join(scratch, `code-${Date.now()}-${Math.random().toString(36).slice(2)}.js`); writeFileSync(file, body); return cli('run-code', `--filename=${file}`); }
const assert = (condition, message, detail) => { observations.push({ ok: !!condition, message, ...(detail !== undefined ? { detail } : {}) }); if (!condition) throw new Error(`${message}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`); };
const reader = () => json(`const box = document.querySelector('.replay'); if (!box) return { present: false }; return { present: true, verdict: box.querySelector('.verdict')?.textContent ?? null, label: box.querySelector('.label')?.textContent ?? null, rows: [...box.querySelectorAll('.option-list li')].map((li) => ({ pill: li.querySelector('.pill')?.textContent, label: li.querySelector('b')?.textContent })), error: box.querySelector('.error')?.textContent ?? null, note: box.querySelector('.muted')?.textContent ?? null };`);
const liveVerdict = () => evaluate(`document.querySelector('.decision .verdict')?.textContent`);
const loadFile = (file) => runCode(`async page => { await page.setInputFiles('input[type=file]', ${JSON.stringify(file)}); }`);
/** A fresh browser context of THIS session with the clock installed once at `time` and the page loaded; the earlier context of this session is closed first. */
async function freshContext(label, time) {
  if (contexts.length) checkConsole(contexts.at(-1));
  closeSession();
  cli('open', SITE);
  runCode(`async page => { await page.clock.install({ time: ${JSON.stringify(time)} }); await page.reload(); }`);
  await waitFor(`the page (${label})`, `return document.querySelector('#entry-title') ? 1 : 0;`);
  contexts.push(label);
}
function checkConsole(label) {
  const consoleOut = cli('console', 'error');
  const errorCount = Number((consoleOut.match(/Errors: (\d+)/) || [])[1] ?? NaN);
  assert(errorCount === 0, `no console errors in the ${label} context`, consoleOut.split('\n').filter((line) => line.trim()).slice(0, 6));
}

try {
  assert(DEADLINE === '2026-10-25T19:05:17.293Z', 'the retained live release of 2026-10-25 is the subject', DEADLINE);
  // Context 1. R06-A: before the deadline the loaded release is usable; R06-B: the clock crosses the deadline and the page's own timer wakes it, with no re-import.
  await freshContext('crossing', BEFORE);
  loadFile(RELEASE_FILE);
  const usable = await waitFor('the loaded release', `const v = document.querySelector('.replay .verdict'); return v ? v.textContent : null;`);
  let view = reader();
  assert(/At least one entry may be used now/.test(usable) && view.rows[0].pill === 'selectable' && /deadline-only/.test(view.label), 'R06-A: just before its deadline the loaded release shows its entry selectable, deadline-only', view);
  assert(/the chain was not read/.test(view.note || ''), 'R06-E: the reader discloses that no fresh chain verification was made', view.note);
  runCode(`async page => { await page.clock.runFor('00:02:00'); }`);
  const lapsed = await waitFor('the lapsed reader', `const v = document.querySelector('.replay .verdict'); return v && /Nothing in this file may be used now/.test(v.textContent) ? v.textContent : null;`, 20_000);
  view = reader();
  assert(/Nothing in this file may be used now/.test(lapsed) && view.rows.every((row) => row.pill === 'not selectable') && /lapsed/.test(JSON.stringify(json(`return [...document.querySelectorAll('.replay .option-list small')].map((s) => s.textContent);`))), 'R06-B: past the deadline the verdict and every selector row turn unavailable without a re-import', view);
  assert(/deadline-only/.test(view.label), 'R06-E: a clock update is still not a chain read', view.label);
  assert(/Not checked yet/.test(liveVerdict() || ''), 'R06-F: the live decision control grants nothing from the loaded reader', liveVerdict());
  // Context 2. R06-C: suspended before the deadline, resumed after it. The system time moves past the deadline without any timer firing (a suspended tab), then the visibility event alone updates the reader.
  await freshContext('resume', BEFORE);
  loadFile(RELEASE_FILE);
  await waitFor('usable again', `const v = document.querySelector('.replay .verdict'); return v && /At least one entry/.test(v.textContent) ? 1 : 0;`);
  runCode(`async page => { await page.clock.setSystemTime(${JSON.stringify(new Date(Date.parse(DEADLINE) + 6 * 60_000).toISOString())}); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); }`);
  const resumed = await waitFor('the reader after the tab came back', `const v = document.querySelector('.replay .verdict'); return v && /Nothing in this file may be used now/.test(v.textContent) ? v.textContent : null;`, 20_000);
  view = reader();
  assert(/Nothing in this file may be used now/.test(resumed) && view.rows.every((row) => row.pill === 'not selectable'), 'R06-C: resuming after the deadline leaves no stale eligible state', view);
  assert(/deadline-only/.test(view.label), 'R06-E: the resumed reader still claims no chain read', view.label);
  // Context 3. R06-D, R06-F: a tampered file replaces the decision with a verification failure; a malformed file clears the presentation; reloading an expired document grants nothing.
  await freshContext('files', BEFORE);
  const tamperedPath = path.join(scratch, 'tampered.json');
  writeFileSync(tamperedPath, JSON.stringify({ ...release, entries: [{ ...release.entries[0], decimals: 18 }] }));
  loadFile(tamperedPath);
  const tampered = await waitFor('the tampered reader', `const box = document.querySelector('.replay'); return box && /tampered\\.json/.test(box.querySelector('.label')?.textContent ?? '') ? box.querySelector('.verdict')?.textContent : null;`);
  view = reader();
  assert(/Nothing in this file may be used now/.test(tampered) && /Verification failed/.test(view.error || '') && view.rows.every((row) => row.pill === 'not selectable'), 'R06-D: a hash-invalid document grants nothing and says why, even before the deadline', view);
  const malformedPath = path.join(scratch, 'malformed.json');
  writeFileSync(malformedPath, '{not json');
  loadFile(malformedPath);
  const cleared = await waitFor('the cleared reader', `return !document.querySelector('.replay') && /could not be read as a catalog release/.test(document.querySelector('.error[role=alert]')?.textContent ?? '') ? 1 : 0;`);
  assert(cleared === 1, 'R06-F: an unreadable file replaces the earlier presentation with the error', cleared);
  runCode(`async page => { await page.clock.setSystemTime(${JSON.stringify(new Date(Date.parse(DEADLINE) + 86_400_000).toISOString())}); }`);
  loadFile(RELEASE_FILE);
  const expiredAgain = await waitFor('the expired release re-imported', `const v = document.querySelector('.replay .verdict'); return v ? v.textContent : null;`);
  assert(/Nothing in this file may be used now/.test(expiredAgain), 'R06-D: re-importing an expired document grants nothing', expiredAgain);
  assert(/Not checked yet/.test(liveVerdict() || ''), 'R06-F: the live control is still untouched', liveVerdict());
  checkConsole(contexts.at(-1));
  const result = { ok: true, site: SITE, at: new Date().toISOString(), release: { version: release.version, releaseHash: release.releaseHash, validUntil: DEADLINE }, contexts, observations };
  console.log(JSON.stringify(result, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message, contexts, observations }, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify({ ok: false, error: error.message, contexts, observations }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  closeSession();
}
