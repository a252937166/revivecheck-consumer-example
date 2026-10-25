# ReviveCheck consumer example: a DEX allow-list with a public Token eligibility demo

A second, separately built consumer of [ReviveCheck](https://github.com/a252937166/ReviveCheck), outside its source tree, that answers two questions: can the library be installed from a reproducible package artifact and used by a clean project through nothing but its documented interfaces, and can a real application action obey the decision it produces?

The consumer is a DEX allow-list for one token, pUSD on the Portaldot V3 testnet. The token is on the list only while two things hold at once:

1. this repository's **own policy** (`config/allowlist.json`) evaluates the bound release to `valid`, and
2. the entry the list publishes equals, field by field, the entry the approved report verified on-chain through both interfaces.

Everything is read-only. No key is held, nothing is signed, no transaction is sent. The example was built and run by the ReviveCheck project: it shows portability and a reusable integration, not independent adoption.

## The public interface: Token eligibility demo

`web/` is a static browser application that anyone can open, with no login, invitation, wallet connection or administrator approval. It runs the same evaluator as the command line (`src/evaluate.js`) in the visitor's browser against the public testnet nodes. The journey it supports, completed in a clean browser session on 2026-10-25 (`ONBOARDING_LOG.md`):

1. Open the page. It starts from a deliberately wrong entry: eighteen decimals where the approved report verified six.
2. **Check token**: the page retrieves the bound report from the chain (`retrieveEvidence`), creates this consumer's binding, collects fresh reads (`collectPolicyInputs`), evaluates (`evaluateBinding`), derives the entry from the approved report and withholds it with `entry-mismatch:decimals`, while the policy evaluation itself is `valid`.
3. **Inspect evidence in ReviveCheck**: opens the exact bound report in the ReviveCheck App (`https://revivecheck.axiqo.xyz/?report=1faef921…#/review`), where its fingerprint is verified and it can be replayed at its pinned block. The same report hash is visible on both sides.
4. Correct the entry to the approved values. The decision resets to "Not checked yet"; a corrected field causes a new evaluation.
5. **Refresh status**: a fresh evaluation under this consumer's policy returns "Available now".
6. **Choose a token**: the selector offers pUSD only while the current decision is valid and the entry equals the approved report; the option is built from the allow-list the evaluator produced, not from a flag. "Continue" is enabled only on a selectable option.
7. **Recorded states**: reads captured on the testnet on 2026-10-25 (approved and listed, revision superseded, approval revoked, node unavailable, evidence expired by the policy clock) replayed through the same logic with a persistent "RECORDED" label. A recorded state never enables the selector.
8. **Download decision evidence**: the `revivecheck.decision-evidence.v1` document (JSON) and a human-readable sheet (HTML with QR codes), which `node src/reconstruct.js <file>` re-derives offline.

The current decision has explicit states (not checked, checking, valid, recheck required, expired, unknown) from `revivecheck/current`: a refresh withdraws the permission until a fresh result arrives; a thrown error or a timeout (90 s) is unknown; a result older than the policy's observation limit (900 s) lapses, also when the tab comes back; the last verified result and the recorded snapshot are shown as history. Nothing is stored in the browser.

Run it locally with `npm run web:dev` (http://127.0.0.1:4190/) or build it with `npm run web:build` and serve `dist-web/`. `.github/workflows/pages.yml` publishes it to GitHub Pages on every push to `main` once the repository has a public remote; at the time of writing it has none, so no public URL exists yet.

## What is in the box

| Path | What |
| --- | --- |
| `vendor/revivecheck-0.4.0.tgz`, `vendor/CHECKSUMS.txt` | the package artifact produced with `npm pack` from the ReviveCheck checkout, with its SHA-256 |
| `package.json`, `package-lock.json` | depends on `"revivecheck": "file:vendor/revivecheck-0.4.0.tgz"`; Node 22; Vite, React and `qrcode` only for the browser build |
| `config/allowlist.json` | the allow-list configuration: the policy, the release it relies on, the entry the operator intends to publish, and who controls each role |
| `src/evaluate.js` | the evaluator shared by the command line and the browser: live (`runLive`) or from a fixture (`runFixture`), then `decide` |
| `src/check.js` | the command: live or offline (`--fixture`), writes `allowlist.json`, `evaluation.json`, `inputs.json`, `decision-evidence.json` |
| `src/allowlist.js` | the allow-list rule, derived from the approved report; this consumer's own implementation of the published-entry invariant on the public interfaces |
| `src/selector.js` | the token selector's options, derived from the allow-list output and the current decision |
| `src/decision-evidence.js`, `src/reconstruct.js` | the portable decision document and the second-reader command that re-derives it |
| `web/` | the Token eligibility demo (React, Vite) |
| `fixtures/*.json` | raw reads captured live on the testnet, labelled with provenance, for the refusal cases |
| `scripts/import-capture.js` | how the fixtures were derived from the upstream captures |
| `test/*.test.js` | the refusal cases, the evaluator, the selector and the decision evidence, run with `node --test` |
| `.github/workflows/allowlist.yml`, `pages.yml` | CI: offline tests and fixture checks with reconstruction and per-case artifacts, a manual live job; the Pages deployment |
| `out/` | the outputs of the live run recorded on 2026-10-25 at 13:36 UTC |
| `ONBOARDING_LOG.md` | the log of the clean-environment runs, including every point where the author's source was read |

## Install from scratch

```sh
git clone <this repository> revivecheck-consumer-example
cd revivecheck-consumer-example
node -v                                           # v22 or later
(cd vendor && shasum -a 256 -c CHECKSUMS.txt)     # Linux: cd vendor && grep -v '^#' CHECKSUMS.txt | sha256sum -c -
npm ci                                            # installs revivecheck from vendor/revivecheck-0.4.0.tgz
npm test                                          # offline: refusal cases, evaluator, selector, decision evidence
```

The package artifact:

| | |
| --- | --- |
| File | `vendor/revivecheck-0.4.0.tgz` |
| SHA-256 | `aa48acddc3c7d779cfc2849c7c5331c09802db24d50f6b28ddc0702ea87fcf35` |
| Size | 119,138 bytes packed, 44 files |
| Produced | 2026-10-25 with `npm pack --pack-destination <this repo>/vendor` inside the ReviveCheck checkout at commit `6b7402f` (branch `redesign/custody-record`, clean working tree); upstream verified the same artifact from an empty project (`artifacts/package-verification-2026-10-25.json` there) |
| Contents | `lib/` (including `entry.js`, `current.js`, `decision.js`), `contracts/*.sol`, `contracts/deployed/v1/`, `mcp/`, `scripts/revivecheck.js`, `public/lifecycle/reference.json` and `registry.json` (the MCP resources), `docs/API.md`, `docs/POLICY.md`, `docs/INTEGRATION.md`, `docs/LIBRARY.md`, `README.md`, `LICENSE`, `package.json` |

Upstream now declares its web and server dependencies as development dependencies, so a headless consumer installs the library alone: upstream's own verification from an empty project measured 204 packages and 170.6 MB (`artifacts/package-verification-2026-10-25.json` in the ReviveCheck repository), against 233 packages and 388 MB for the 0.3.0 artifact. This repository installs 317 packages (247 MB) because it also carries Vite, React and `qrcode` for the browser build.

To rebuild the artifact yourself: check out the ReviveCheck repository at the state you want, run `npm pack --pack-destination <path>` there, and compare the SHA-256.

## Run it

```sh
# Live: fetch the bound report from the chain, read the registry, the consumer listing and the
# network, evaluate, derive the entry from the approved report, write out/. Exit 0 only when allowed.
npm run check

# Offline, from captured reads. The same code path, minus the network.
npm run check -- --fixture fixtures/valid-r2.json
npm run check -- --fixture fixtures/valid-r2.json --config fixtures/config-wrong-decimals.json   # exit 1
npm run check -- --fixture fixtures/superseded-r1.json                                           # exit 1
npm run check -- --fixture fixtures/revoked-r2.json                                              # exit 1
npm run check -- --fixture fixtures/unavailable.json                                             # exit 1
npm run check -- --fixture fixtures/valid-r2.json --now 2026-11-02T09:43:18.329Z                 # exit 1: expired

# Reconstruct a decision from its evidence document alone (no network, no other file).
npm run reconstruct -- out/decision-evidence.json

# The browser demo.
npm run web:dev          # http://127.0.0.1:4190/
npm run web:build        # dist-web/

# Options of check: --config <file>, --out <dir> (default out), --now <ISO time>, --retries <n> (live, default 3)
```

The packaged CLI is also on the path after install: `npx revivecheck --help` lists the read-only tools.

### What the live command does, step by step

1. Loads `config/allowlist.json`, validates the policy with `normalizePolicy` and computes `policyHash`.
2. **Fetches the report from the chain**: `retrieveEvidence({ extrinsicHash, blockHash, expectedHash })` reads the `remark.store` extrinsic named in the configuration, checks the `Remark.Stored` event, recomputes the report's SHA-256 and compares it with the expected hash. No report file is copied from any workspace.
3. Creates this consumer's binding with `createBinding({ policy, report, releaseId, revision, boundBy, note, storage })`.
4. `collectPolicyInputs({ policy, binding })` reads, at one finalized block each, the network observation, the ReleaseRegistry (release state and the decision of every trusted reviewer) and the VerifiedTokenList v2 listing through both the EVM RPC and ReviveApi, and retrieves the stored report again as evidence.
5. `evaluateBinding({ policy, binding, report, observation, registry, listing, evidence, now })` returns the `revivecheck.policy-evaluation.v1` document.
6. `src/allowlist.js` derives the entry from the approved report and compares it with the configured entry; `src/decision-evidence.js` builds the decision document.
7. Writes `out/allowlist.json`, `out/evaluation.json`, `out/inputs.json`, `out/decision-evidence.json`, then `closeConnections()`.

When a public node does not answer, the command retries up to `--retries` times and records every attempt in `out/inputs.json`. An evaluation whose reads failed is `unknown`, denied, exit 1.

## Interfaces used

From the installed package, by subpath export (documented in the package's `docs/LIBRARY.md`):

| Import | Used for |
| --- | --- |
| `revivecheck/policy` | `normalizePolicy`, `policyHash`, `createBinding`, `evaluateBinding`, `summarizeEvaluation` (and `verifyBinding`, `REASONS` in the tests) |
| `revivecheck/service` | `retrieveEvidence`, `collectPolicyInputs`, `closeConnections` |
| `revivecheck/report` | `verifyRun`, `fingerprint` |
| `revivecheck/entry` | `entryDecision`, `canonicalEntry` (the browser's entry comparison; `src/allowlist.js` keeps its own implementation of the same rule for the allow-list document) |
| `revivecheck/current` | `initialDecision`, `beginCheck`, `settleCheck`, `failCheck`, `changeSelection`, `ageDecision`, `canAct`, `describeDecision` |
| `revivecheck/decision` | `buildDecisionEvidence`, `reconstructDecision`, `formatReconstruction`, `decisionSheetHtml`, `explainReason`, `evidenceExpiry`, `RENEWAL_STEPS` |
| `revivecheck/package.json` | the installed version |

Documents, as defined in the package's `docs/POLICY.md` and `docs/LIBRARY.md`:

- **`revivecheck.policy.v1`**: authored here, in `config/allowlist.json`. Network testnet (chain 420420777), runtime `portaldot-v3/3002`, subject native asset 7777 at `0x00001e6100000000000000000000000000010000`, plan hash `ce76c98f…2191`, evidence scope `portaldot-testnet-readonly` with `maxAgeSeconds` 604800, `maxObservationAgeSeconds` 900, `requireInterfacesAgree` and `requireStoredOnChain` true, trusted reviewer `0x95db300103ec8b45884b13ed85230fbf02114065` with threshold 1 and a basis text stating that the reviewer and the release owner are both project-controlled, registry `0xe949b200edf070b9d425b206ed24dc8fe5b7d339` with owner `0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b` and label `pusd-catalog-v2`, consumer `0xedaf8a25bb583ad164a94191b762414277198df9` version 2. Its hash is `795942d67b86c2c9b35c07fe3e24f2d8796dbd01ea79806b35cf125aaf44f8c3`, which differs from the upstream example catalog's policy (`ce1388f9…34fd`): same subject, different author, different text.
- **`revivecheck.binding.v1`**: created at run time by `createBinding`, never stored as configuration.
- **`revivecheck.policy-evaluation.v1`**: `out/evaluation.json`, self-hashed.
- **`revivecheck.decision-evidence.v1`**: `out/decision-evidence.json`: the policy, binding, report, inputs and evaluation with every identity hash, the entry comparison, the reviewer trust basis, the storage locator, evidence age and expiry, observation freshness, checkpoints, the outcome with reasons (each naming who acts and what happens next), verified links and QR payloads, hashed as `evidenceHash`. `src/reconstruct.js` re-derives the evaluation, the entry comparison and the outcome from it and exits 1 on any difference.

This repository's own documents: `revivecheck-consumer.config.v1`, `revivecheck-consumer.fixture.v1`, `revivecheck-consumer.inputs.v1` and `revivecheck-consumer.allowlist.v1` (the allow-list a DEX would read: `allow` holds the entry only under a `valid` evaluation with a matching entry; `denied` names the reason codes and the next action).

## The refusal cases (`npm test`)

| Scenario | Fixture | Result |
| --- | --- | --- |
| Approved revision 2, correct entry | `valid-r2.json` | **allowed**, exit 0, `valid` |
| Wrong decimals in the configuration (18 instead of 6) | `valid-r2.json` with `config-wrong-decimals.json` | denied, `entry-mismatch:decimals`; the policy evaluation itself is `valid` |
| Binding names revision 1 / `eb960cc7…` while the registry holds revision 2 | `superseded-r1.json` | denied, `recheck-required`: `revision-superseded`, `approval-missing`, `consumer-not-listed` |
| Trusted reviewer requested changes | `revoked-r2.json` | denied, `recheck-required`: `approval-revoked`, `consumer-not-listed` |
| Every read replaced by `{ error }` | `unavailable.json` | denied, `unknown`: `observation-missing`, `registry-unavailable`, `consumer-unavailable`, `storage-unverified` |
| Evaluated eight days after the capture | `valid-r2.json --now 2026-11-02T09:43:18.329Z` | denied, `expired`: `evidence-expired`, `observation-stale` |
| At the expiry boundary | `--now 2026-11-01T09:29:17.646Z` is still acceptable; one millisecond later is `expired` | `test/evaluate.test.js` |

`test/evaluate.test.js` also proves, offline, what the page does: the wrong entry is denied and the corrected one allowed from the same reads; every refusal, a failed check and a lapsed result leave the selector unavailable; every decision document reconstructs, and a changed outcome fails reconstruction.

The fixtures reuse raw reads that the upstream ReviveCheck example catalog captured live on 2026-10-25 under its own policy; the upstream policy hash is recorded as provenance and not used. `scripts/import-capture.js` is the exact derivation.

## The live runs recorded here

`out/` holds the live run of 2026-10-25T13:36:28.849Z (`npm run check`, 20.8 s wall clock, first attempt): **ALLOWED**, evaluation `valid` at finalized block #189599 for the registry read, the network observation and the listing; report `1faef921…` retrieved from extrinsic `0x80d46a86…feb3` in block #187145; policy hash `795942d6…f8c3`; `decision-evidence.json` SHA-256 `add90c6c…` reconstructs consistently. The earlier live run of 09:59:21Z (block #187437, against the 0.3.0 artifact) is recorded in `ONBOARDING_LOG.md`.

In the browser the same evaluator ran twice in the recorded session of 2026-10-25: withheld with the wrong entry at #189591, allowed with the corrected entry at #189595.

## Expiry

`maxAgeSeconds` is 604800 (seven days), evaluated off-chain from the report's `completedAt` and the evaluator's clock. The bound report completed at 2026-10-25T09:29:17.646Z, so from **2026-11-01T09:29:17.646Z** this allow-list evaluates `expired` and denies the entry, even though nothing on the chain changes. To keep the token listed past that date the release owner has to check the release again, a trusted reviewer has to approve the new report's exact hash, and the configuration here has to name the new report, revision and storage extrinsic; the page shows the expiry and the renewal steps by role (`RENEWAL_STEPS`). The old report, binding and evaluation stay as history.

## What this proves, and what it does not

It proves:

- **Portability.** The library installs from a packed tarball in a project with no access to the source tree, and the documented subpath exports resolve and work, in Node and in a browser bundle.
- **A second use of the documented interface with a real consequence.** This consumer implements the business rule with the public interfaces only, retrieves the bound report from chain data at run time, and lets a token selector obey its own fresh decision.
- **Refusals are real and portable.** Each refusal case runs through the actual command and the actual page, exits non-zero, and produces a decision document a second reader reconstructs.

It does not prove:

- **An external builder.** This repository was built by an AI agent on the ReviveCheck author's machine; `ONBOARDING_LOG.md` lists every instance where the author's source was read. Nobody outside the project has repeated this.
- **Adoption.** No third party runs this list or this page.
- **Independent review.** The trusted reviewer (`0x95db…4065`) and the release owner (`0x48b9…a71b`) are both accounts controlled by the ReviveCheck project. The on-chain record shows role separation between two signers, nothing more.
- **RPC honesty or future state.** The evaluator trusts the public nodes it reads, and a `valid` result is a point-in-time statement; evaluate again before each use.

## CI

`.github/workflows/allowlist.yml` runs on push, pull request and manual dispatch: verify the tarball checksum, `npm ci`, `npm test`, the `valid-r2` fixture check (must pass), the wrong-decimals, superseded, revoked, unavailable and expired cases (must fail), reconstruction of every decision document, the browser build, and keeps every case's outputs as an artifact. A separate manual `live` job runs `npm run check` against the public nodes, reconstructs the live decision, and fails when the nodes do not answer. `.github/workflows/pages.yml` builds and deploys the demo to GitHub Pages with a `hosting.json` naming the built commit. The workflows become inspectable only after the repository is pushed to a remote.

## Licence

MIT, see `LICENSE`. The vendored ReviveCheck package is MIT licensed by its own authors (`node_modules/revivecheck/LICENSE` after install).
