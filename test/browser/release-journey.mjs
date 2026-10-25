#!/usr/bin/env node
// The public journey of the Token eligibility demo with the release operation, driven in a
// fresh Chromium profile with playwright-cli against a served build (not part of `npm test`:
// it needs a browser, `npm run web:preview` and the public testnet nodes).
//
//   node test/browser/release-journey.mjs [--site http://127.0.0.1:4191/] [--session consumer] [--out <file>]
//
// Steps: wrong entry withheld → corrected → "Available now" → Prepare catalog release
// (the download is captured and verified in Node, then read by the revivecheck-catalog
// command) → the release card shows the version, hash and deadline → the file is loaded
// back through "Load a release file" and the reader fills its selector.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCatalogRelease } from 'revivecheck/catalog-release';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const SITE = option('--site', 'http://127.0.0.1:4191/').replace(/\/?$/, '/');
const SESSION = option('--session', 'consumer');
const OUT = option('--out', null);
const observations = [];
const scratch = mkdtempSync(path.join(tmpdir(), 'consumer-journey-'));
function cli(...parts) { const result = spawnSync('playwright-cli', ['-s', SESSION, ...parts], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); if (result.status !== 0) throw new Error(`playwright-cli ${parts[0]} failed: ${(result.stderr || result.stdout).slice(0, 600)}`); return result.stdout; }
const evaluate = (js) => { const out = cli('--raw', 'eval', js).trim(); try { return JSON.parse(out); } catch { return out; } };
const json = (js) => JSON.parse(evaluate(`JSON.stringify((() => { ${js} })())`) || 'null');
async function waitFor(label, js, timeoutMs = 150_000) { const started = Date.now(); for (;;) { const value = json(js); if (value) return value; if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`); await new Promise((resolve) => setTimeout(resolve, 2000)); } }
function runCode(body) { const file = path.join(scratch, `code-${Date.now()}.js`); writeFileSync(file, body); return cli('run-code', `--filename=${file}`); }
const assert = (condition, message, detail) => { observations.push({ ok: !!condition, message, ...(detail !== undefined ? { detail } : {}) }); if (!condition) throw new Error(`${message}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`); };
const verdict = () => json(`return { verdict: document.querySelector('.verdict')?.textContent ?? null, pills: [...document.querySelectorAll('.decision .pill')].map((p) => p.textContent), deadline: document.querySelector('.deadline')?.textContent ?? null, checking: !!document.querySelector('.progress') };`);

try {
  cli('open', SITE);
  runCode(`async page => { await page.evaluate(() => localStorage.clear()); await page.reload(); }`);
  await waitFor('the page', `return document.querySelector('#entry-title') ? 1 : 0;`, 30_000);
  // 1. The wrong entry (18 decimals) is withheld, with the policy itself valid.
  cli('click', "getByRole('button', { name: 'Check token' })");
  const withheld = await waitFor('the first check', `const v = document.querySelector('.verdict')?.textContent; return v && !/Checking|Not checked/.test(v) && !document.querySelector('.progress') ? v : null;`);
  assert(/Withheld: the entry differs from the approved report/.test(withheld), 'the wrong entry is withheld and the field named', withheld);
  assert(json(`return [...document.querySelectorAll('.reasons code')].map((c) => c.textContent);`).includes('entry-mismatch:decimals'), 'entry-mismatch:decimals is the reason');
  const releaseButton = () => json(`const b = [...document.querySelectorAll('button')].find((item) => item.textContent === 'Prepare catalog release'); return b ? { disabled: b.disabled } : null;`);
  assert(releaseButton()?.disabled === true, 'the release button is disabled while the entry is withheld', releaseButton());
  // 2. Correct the entry, check again: available now with a deadline.
  cli('click', "getByRole('button', { name: 'Correct to the approved values' })");
  cli('click', "getByRole('button', { name: 'Check token' })");
  const available = await waitFor('the second check', `const v = document.querySelector('.verdict')?.textContent; return v && /Available now/.test(v) && !document.querySelector('.progress') ? v : null;`);
  const state = verdict();
  assert(/Available now/.test(available) && /Permission ends/.test(state.deadline || ''), 'the corrected entry is available with a stated deadline', state);
  // 3. Choose the entry and prepare the release; the download is captured.
  runCode(`async page => { await page.selectOption('.selector select', '0x00001e6100000000000000000000000000010000'); }`);
  await waitFor('the release button', `const b = [...document.querySelectorAll('button')].find((item) => item.textContent === 'Prepare catalog release'); return b && !b.disabled ? 1 : 0;`, 15_000);
  const downloadPath = path.join(scratch, 'release.json');
  runCode(`async page => { const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Prepare catalog release' }).click()]); await download.saveAs(${JSON.stringify(downloadPath)}); }`);
  const release = JSON.parse(readFileSync(downloadPath, 'utf8'));
  assert(release.schema === 'revivecheck.catalog-release.v1' && release.version === 1 && release.entries.length === 1 && release.entries[0].decimals === 6, 'the downloaded release holds the eligible entry from the approved report', { version: release.version, entries: release.entries.length, hash: release.releaseHash });
  assert(verifyCatalogRelease(release).ok, 'the downloaded release verifies from the document alone in Node');
  const notice = evaluate(`document.querySelector('.ok[role="status"]')?.textContent ?? null`);
  assert(/^Release 1 prepared at/.test(notice || ''), 'the page reports the release', notice);
  const card = await waitFor('the release card', `const li = document.querySelector('.releases li'); return li ? li.textContent : null;`, 15_000);
  assert(/usable now/.test(card) && /Release 1/.test(card) && /checks pass from the document alone/.test(card), 'the release card shows it usable now and verified', card.slice(0, 300));
  // 4. The command-line reader uses the same file in another process, at the clock of generation.
  const gate = spawnSync(path.join(root, 'node_modules', '.bin', 'revivecheck-catalog'), ['read', downloadPath, '--now', release.generatedAt], { encoding: 'utf8' });
  assert(gate.status === 0 && /USABLE   pUSD/.test(gate.stdout), 'revivecheck-catalog read uses the browser-made release', gate.stdout.split('\n').slice(0, 4));
  // 5. Load the file back through the page's reader.
  runCode(`async page => { await page.setInputFiles('input[type=file]', ${JSON.stringify(downloadPath)}); }`);
  const loaded = await waitFor('the loaded release', `const el = document.querySelector('.replay .verdict'); return el ? el.textContent : null;`, 15_000);
  assert(/At least one entry may be used now/.test(loaded), 'the loaded release fills the reader selector', loaded);
  const consoleOut = cli('console', 'error');
  const errorCount = Number((consoleOut.match(/Errors: (\d+)/) || [])[1] ?? NaN);
  assert(errorCount === 0, 'no console errors during the journey', consoleOut.split('\n').filter((line) => line.trim()).slice(0, 6));
  const result = { ok: true, site: SITE, at: new Date().toISOString(), release: { version: release.version, releaseHash: release.releaseHash, generatedAt: release.generatedAt, validUntil: release.validity.validUntil, evaluationHash: release.entries[0].evaluationHash, checkpoint: release.entries[0].checkpoints }, observations };
  console.log(JSON.stringify(result, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message, observations }, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify({ ok: false, error: error.message, observations }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  spawnSync('playwright-cli', ['-s', SESSION, 'close'], { encoding: 'utf8' });
}
