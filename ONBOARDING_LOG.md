# Onboarding log: installing and using ReviveCheck from a clean consumer

**Who did this.** An AI agent (Claude, model Fable 5.1, running in Claude Code) on the ReviveCheck author's machine, on 2026-10-25, with the author's ReviveCheck checkout mounted read-only next to this repository. This was **not** performed by an external builder. The agent was given a brief by the author that named the live facts (addresses, release ID, revision, report hashes, storage extrinsics) and the documented interfaces to use. Everything below that goes beyond the packaged documentation is marked **author assistance**.

**Scope.** Prove assessment item A-05, "integration from a clean consumer environment": install ReviveCheck from a package artifact into a project outside its source tree and use it through its documented interfaces for a real business rule (a DEX allow-list). Read-only throughout: nothing was signed, no transaction was sent, nothing under the author's `.private/` was read, and no file in the ReviveCheck checkout was modified or committed.

## Environment

| | |
| --- | --- |
| Node | v22.23.1 |
| npm | 10.9.8 |
| OS | macOS 27.0.1 (Darwin 27.0.0, arm64, Apple Silicon) |
| Shell | zsh (two shell slips below are zsh-specific) |
| Network | the author's connection to the public Portaldot V3 testnet nodes `wss://test-node-v3.portaldot.dev` and `https://test-evm-rpc-v3.portaldot.dev` |
| Source checkout read | `portaldot-hacker-house-2026-redesign`, branch `redesign/custody-record`, HEAD `4dfb1e3`, with uncommitted working-tree changes made concurrently by another process |

All times UTC.

## Timeline

| Time | Step | Duration | Result |
| --- | --- | --- | --- |
| 09:47:48 | Record environment (`node -v`, `npm -v`, `uname`, `sw_vers`) | 1 s | above |
| 09:47–09:51 | Read the documentation the package ships: `docs/POLICY.md`, `docs/INTEGRATION.md`, `docs/API.md`, `README.md`; and the example consumer's `examples/token-catalog/README.md` | about 3 min | schemas and semantics understood; function signatures for `createBinding`, `collectPolicyInputs`, `evaluateBinding` and the `retrieveEvidence` return shape are **not** in the documentation, see author assistance |
| 09:48–09:51 | Read library source and the example consumer (author assistance 1–8 below) | within the same 3 min | signatures and return shapes learned |
| 09:51:24 | `npm pack --pack-destination <consumer>/vendor` inside the ReviveCheck checkout | **2 s**, exit 0 | `revivecheck-0.3.0.tgz`, 97,699 bytes, 38 files, SHA-256 `e93c32da088e653f4d30708f523994e53f4fae85eb4f95f15e843493d75c9177`; `git status --porcelain` of the checkout identical before and after, so the pack created no files there; `"private": true` did not block packing |
| 09:52–09:55 | Write `package.json`, `vendor/CHECKSUMS.txt`, `.gitignore`, `LICENSE`, `config/allowlist.json`, `scripts/import-capture.js` | about 3 min | failure 1 found and fixed before running |
| 09:55:15 | `npm install --no-fund --no-audit` | **23 s**, exit 0 | 233 packages, lockfile v3 with the tarball's sha512 integrity; `node_modules` 388 MB; two deprecation warnings (failure 5) |
| 09:55 | `node scripts/import-capture.js --source <checkout> --out fixtures` | 1 s, exit 0 | `valid-r2.json`, `superseded-r1.json`, `revoked-r2.json`, `unavailable.json`; `fixtures/config-wrong-decimals.json` generated from the configuration |
| 09:56 | Resolve every export specifier from the installed package (`revivecheck`, `/policy`, `/service`, `/report`, `/registry`, `/tokenlist`, `/networks`, `/chain`, `/evidence`, `/plan`, `/demo`, `/lib/share.js`, `/contracts/VerifiedTokenList.sol`, `/package.json`) and check the named functions | about 1 s of module loading | all 14 resolved; all 18 named functions present with the expected types (failure 2 was the shell wrapper, not the package) |
| 09:57 | Six offline scenarios through `node src/check.js --fixture …` | 0–2 s each | valid: ALLOWED; wrong decimals: DENIED `entry-mismatch:decimals` with a `valid` evaluation; superseded: `recheck-required` (`revision-superseded`, `approval-missing`, `consumer-not-listed`); revoked: `recheck-required` (`approval-revoked`, `consumer-not-listed`); unavailable: `unknown` (four `*-unavailable`/`-missing`/`-unverified` codes); expired with `--now` +8 days: `expired` (`evidence-expired`, `observation-stale`). Failures 3 and 4 noted |
| 09:57 | `npx revivecheck --help` (the packaged `bin`) | 4 s, exit 0 | lists the thirteen read-only tools; `node_modules/.bin/revivecheck` and `revivecheck-mcp` link correctly |
| 09:57 | `shasum -a 256 -c vendor/CHECKSUMS.txt` | <1 s | OK (comment lines tolerated by macOS `shasum`; CI uses `grep -v '^#' … \| sha256sum -c -` for GNU coreutils) |
| 09:59:01 | **Live** `npm run check` | **22 s** wall clock, exit 0 | ALLOWED on the first attempt. `retrieveEvidence` 9,876 ms (report `1faef921…` from block #187145, 7,404 bytes, publisher `5GH8LpSTf6sp31FeacbFE99E3b9NQb5E7xWHeBL8XqW3YhTt`); `collectPolicyInputs` 8,678 ms; all three reads at finalized block #187437; evaluation `valid`, 35/35 checks; `evaluatedAt` 2026-10-25T09:59:21.688Z; evaluation hash `c799567e1c76991101fd586f3f71372c1159fc15bd1678809c22858bd7bc749b`. No retry was needed. Outputs committed under `out/` |
| 10:00 | `npm test` (`node --test test/*.test.js`) | **6 s**, exit 0 | 10 tests, 10 passed, 0 failed |
| 10:00–10:04 | Write `README.md`, this log; three commits | | `a2eccbd` artifact and manifest, `a909393` consumer and tests, `b052a05` live outputs and docs |
| 10:05:33 | **Fresh clone check**: `git clone` of commit `b052a05` into an empty directory, `shasum -a 256 -c vendor/CHECKSUMS.txt`, `npm ci`, `npm test`, the valid fixture and the outage fixture | 12 s in total (`npm ci` 3 s from the local npm cache, `npm test` 6 s) | checksum OK; 233 packages; 10/10 tests passed; `valid-r2` allowed with exit 0 and the same evaluation hash `c6803afd…` as before; `unavailable` denied with exit 1. The committed state is self-sufficient: nothing outside the repository and the npm cache was needed |
| 10:06 | Parse `.github/workflows/allowlist.yml` with a YAML parser | <1 s | valid; jobs `offline` (8 steps) and `live` (5 steps). The workflow itself has not run, because the repository has not been pushed |

## Failures and how they were resolved

1. **`boundBy` text too long for `createBinding`.** My first configuration text for `boundBy` was 171 characters; `createBinding` limits it to 160. Found by reading `lib/policy.js` before the first run (the limit is not in the documentation), shortened to 140 characters. Self-inflicted, but it shows a gap in the docs: the field limits (`boundBy` 1–160, `note` 400, `basis` 400, `name` 120, `label` 31) are only in source.
2. **Shell slip, timing.** In my export-check wrapper I used `date +%s%3N`, which macOS `date` does not support; zsh reported "bad math expression" and the wrapper exited 1 after every Node check had already printed OK. Not a package failure; re-timed later from Node.
3. **Shell slip, exit codes.** The fixture-run wrapper printed `${PIPESTATUS[0]}`, which is bash; zsh uses `$pipestatus`, so the exit codes printed empty. The exit codes were then asserted authoritatively by the tests through `child_process.spawnSync` (0 for the valid case, 1 for every refusal).
4. **Duplicate reason codes in the expired case.** The upstream evaluator appends one `observation-stale` reason per stale read (observation, registry, listing), so the evaluation document listed the code three times. The evaluation document is left exactly as the library produced it; this consumer de-duplicates codes in its own `allowlist.denied[].reasons`. Upstream observation, not a failure.
5. **Deprecation warnings during install.** `node-domexception@1.0.0` and `@substrate/connect@0.8.11`, both transitive dependencies of the Polkadot stack. No action possible from a consumer.
6. **Dependency weight.** The library manifest declares its web UI and server dependencies (`react`, `react-dom`, `express`, `lucide-react`, `@fontsource-variable/*`, `qrcode`, `solc`, `@polkadot/extension-dapp`, `@modelcontextprotocol/sdk`) as runtime dependencies, so a headless consumer installs 233 packages (388 MB) to use three modules. Everything worked; it is a packaging finding for the author, not a blocker.
7. **Packaged MCP server resources (predicted, not run).** `mcp/server.js` serves `revivecheck://lifecycle/reference` and `revivecheck://registry` from files under `public/`, which the `files` whitelist excludes, and `mcp/tools.js` reads `public/api/registry.json` and `public/reports/<hash>.json` inside `try/catch`. From the tarball the tools degrade gracefully (the reads fall back to the network) but the two resources would fail. I did not start the server (the brief forbids starting servers), so this is a prediction from reading the source, not an observed failure. `npx revivecheck --help` itself works.
8. **No live failure.** The public nodes answered on the first attempt; the retry path (`--retries`, default 3, each attempt recorded in `out/inputs.json`) was not exercised live. It is exercised offline by the `unavailable` fixture, where every read is an error and the result is `unknown`.

## Author assistance: source read beyond the documentation

Each item is something the packaged documentation (`docs/POLICY.md`, `docs/INTEGRATION.md`, `docs/API.md`, `README.md`) did not state and that I had to learn from the author's source or example. An external builder without the checkout would have had to read the same files inside `node_modules/revivecheck/lib/` (they are in the package) or guess.

1. **`lib/policy.js`, read in full.** `createBinding({ policy, report, releaseId, revision, boundBy, boundAt, note, storage, id })` and its validation rules; `evaluateBinding({ policy, binding, report, registry, observation, listing, evidence, now })` and the names of the raw inputs it accepts; the `REASONS` table; the shape of the evaluation document (`checkpoint.registry/observation/listing`, `evaluationHash`, `nextAction`). POLICY.md documents only `evaluatePolicy({ policy, binding, report })`, the schema names and the status semantics.
2. **`lib/service.js`, header and lines 120–176.** `collectPolicyInputs({ policy, binding })` returns `{ observation, registry, listing, evidence, collectedAt }` and turns each failed read into `{ error }`; `retrieveEvidence({ extrinsicHash, blockHash, expectedHash })` returns the parsed report under **`run`** (not `report`) and skips the explorer lookup when `blockHash` is given; `closeConnections()` must be awaited or the process keeps the WebSocket open. INTEGRATION.md shows `retrieve_evidence` as a CLI tool only.
3. **`lib/evidence.js`, grep.** Confirmed the `run` field and the failure `reasons` array.
4. **`lib/report.js`, `lib/networks.js`, export lists.** Confirmed `verifyRun`, `validateImportedRun`, `fingerprint`, `canonical` exist as the brief said; API.md states the hashing rule (canonical JSON without `evidenceHash`) that the tests use to re-seal a modified report.
5. **`examples/token-catalog/lib/catalog.js`, read in full, and `examples/token-catalog/catalog.js`, grep.** How the reference consumer wires `collectPolicyInputs` into `evaluateBinding` and how `approvedEntry`/`compareEntry` derive the published entry from the report's `input.listing` and the `token.listing` check's `evidence.fields`. `src/allowlist.js` re-implements that invariant on the public interfaces; it does not import the example (which is not in the package).
6. **`lib/tokenlist.js`, grep for `TOKEN_LIST`.** Checked whether `readTokenList({ token })` could target the v2 list; it reads the "active" deployment without a way to name an address, so the consumer uses `collectPolicyInputs`, which takes the consumer address from the policy.
7. **`examples/token-catalog/data/testnet-v2/captures/{07,11,12}-*.inputs.json`.** Raw reads captured live by the author's example on 2026-10-25, copied into `fixtures/` with their SHA-256 and the upstream policy hash as provenance. This is data, not code, but it was produced by the author's tooling, not by this consumer; the only reads this consumer captured itself are in `out/inputs.json` from the live run.
8. **grep over `lib/`, `mcp/` and `scripts/revivecheck.js`** for imports or file reads that leave the `files` whitelist, to predict whether the tarball is self-contained (finding 7 above).
9. **The brief itself.** The author supplied the release ID, revision, report hashes, storage extrinsics and block hashes. The live run cross-checked them against the chain: the registry read returned the same owner, revision and report hash, the retrieved report hashed to the expected value, and the listing named the same release, report and reviewer.

Everything else (the policy text, the configuration, the allow-list rule, the fixtures' derivation, the tests, the workflow and this log) was written in this repository without copying code from the checkout.

## Result

- The package installs from `vendor/revivecheck-0.3.0.tgz` (SHA-256 `e93c32da…9177`) in a clean project in 23 seconds; all 14 export specifiers resolve.
- A second consumer, distinct from the upstream example, implements a DEX allow-list on `revivecheck/policy`, `revivecheck/service` and `revivecheck/report` alone, with its own policy (hash `795942d6…f8c3`).
- Live on 2026-10-25T09:59:21.688Z: **allowed**, evaluation `valid` at finalized block #187437, the report fetched from chain data rather than copied.
- Offline: six scenarios behave as specified; `npm test` passes 10 of 10, also from a fresh clone of the committed repository.
- Not shown: an external builder, adoption, independent review (owner and reviewer are project-controlled), or a tagged upstream source state for the tarball (it was packed from a working tree with uncommitted changes).

## Addendum, 2026-10-25T10:34Z: the artifact re-packed from a clean commit

After the ReviveCheck working tree was committed (final commit `8aee632f9eff67211e482605527a043d89aa6b8a`, clean tree), the author's agent ran `npm pack --pack-destination <this repo>/vendor` there again. The new tarball (SHA-256 `472a85e3dacb742d200e2f2b20ef0bac0dba016309c21c5bfe38b7cd99c1f98c`, 99,536 bytes, 38 files) replaced the earlier one (`e93c32da…9177`, packed at 09:51Z from an uncommitted tree). The library code under `lib/` had not changed between the two; the packaged `README.md`, `docs/POLICY.md` and `docs/INTEGRATION.md` had. `vendor/CHECKSUMS.txt` and the README were updated, `npm install` refreshed the lockfile integrity for the file dependency, and `npm test` was run again; the results are recorded in the commit that carries this addendum. The live check of 09:59Z was not repeated; it stands as the record of the first artifact. This still does not make the run an external builder's.

## Addendum, 2026-10-25T13:40Z: the 0.4.0 artifact, the browser interface and the second live run

Who: the same AI agent (Claude, model Fable 5.1, in Claude Code) on the author's machine, with the author's checkout next to this repository. Still not an external builder.

| Time (UTC) | Step | Result |
| --- | --- | --- |
| 13:26 | `npm pack --pack-destination <this repo>/vendor` inside the ReviveCheck checkout (working tree with the day's uncommitted changes; the clean-commit re-pack is recorded below) | `revivecheck-0.4.0.tgz`, 118,382 bytes, 44 files, SHA-256 `a81bfb562b3995db79b1a0fa6625bd58648c48cad56af3340f1a304d8da2382f`. New in the artifact: `lib/entry.js`, `lib/current.js`, `lib/decision.js`, `docs/LIBRARY.md`, and the two MCP resource files; upstream moved its web and server dependencies to development dependencies |
| 13:27 | `npm uninstall revivecheck`, `npm install file:vendor/revivecheck-0.4.0.tgz`, then `npm install --save-dev vite@7.1.12 @vitejs/plugin-react@5.0.4 react@19.1.1 react-dom@19.1.1 qrcode@1.5.4` | 317 packages, `node_modules` 247 MB (the browser build tools included); lockfile integrity refreshed for the file dependency |
| 13:28 | `npm test` against the new artifact, before any new code | 9 of 10 passed; the one failure was this repository's own checksum test still naming 0.3.0, updated afterwards |
| 13:30 | Wrote `src/evaluate.js` (the evaluator shared by the command and the browser), `src/decision-evidence.js`, `src/reconstruct.js`, `src/selector.js`, `web/` (the Token eligibility demo), `test/evaluate.test.js`; `src/check.js` now delegates to the shared evaluator and also writes `decision-evidence.json` | `npm test`: 15 of 15 |
| 13:32 | `npx vite build` | `dist-web/`: `index.html`, one CSS file, a 1.43 MB main chunk (the Polkadot and ethers clients) and a 26 KB service chunk |
| 13:34 to 13:38 | Clean Chromium session (Playwright, empty storage, no wallet) on `vite preview`: the complete journey | wrong entry: "Withheld: the entry differs from the approved report", policy Valid, `entry-mismatch:decimals`, evaluated at #189591, pUSD disabled in the selector; "Correct to the approved values" reset the decision to "Not checked yet"; the second check: "Available now" at #189595, pUSD selectable, Continue enabled; "Approval revoked" replay labelled RECORDED with `approval-revoked`, `consumer-not-listed`, live decision unchanged; changing decimals back to 18 reset the decision again; no overflow at 390 px; no console errors; no browser storage written |
| 13:36 | **Live** `npm run check` | ALLOWED on the first attempt, 20.8 s; `retrieveEvidence` 9,469 ms; all three reads at finalized block #189599; evaluation `4c79e8d6…`; `out/decision-evidence.json` written (`add90c6c…`) and reconstructed consistently by `node src/reconstruct.js` |

Failures and observations:

1. **Locator ambiguity in the browser check.** Playwright's `getByLabel('Decimals')` matched both the decimals input and the selector whose label text contains "6 decimals"; the check used the spinbutton role instead. A test-tooling detail, not a page defect.
2. **A `&&` next to `??` in JSX** broke the first build (esbuild requires parentheses); fixed by removing the mixed expression.
3. **Bundle weight.** `revivecheck/current`, `/entry` and `/decision` import the policy module, which imports the registry and token-list modules and, through them, the chain clients; the main chunk therefore carries the Polkadot and ethers code even before the first check. The page works; it is a packaging observation for upstream.

Author assistance, this time: none beyond the packaged documentation. `docs/LIBRARY.md`, shipped in the 0.4.0 artifact, now states the signatures, return shapes and limits that items 1 to 3 of the first log had to be read from source (`createBinding` and its limits, `collectPolicyInputs`, `retrieveEvidence` returning `run`, `closeConnections`); the three new modules were used from that document alone. The fixtures' raw reads remain the author's captures, as before.

Still not shown: an external builder, adoption, independent review, or a public remote for this repository (the Pages workflow deploys the demo only after a push).

Final re-pack, 2026-10-25T13:50Z: after the upstream work was committed (ReviveCheck commit `6b7402f`, clean tree), `npm pack` there produced `revivecheck-0.4.0.tgz` with SHA-256 `aa48acddc3c7d779cfc2849c7c5331c09802db24d50f6b28ddc0702ea87fcf35` (119,138 bytes, 44 files), which replaced the working-tree pack of 13:26 (`a81bfb56…`; the packed `README.md` and `docs/INTEGRATION.md` had changed in between, `lib/` had not). Upstream's own clean-install verification of this exact artifact: 204 packages, 170.6 MB, 23.7 s. `npm install` refreshed the lockfile integrity, `npm test` and `npm run web:build` were run again; the results are in the commit that carries this line.
