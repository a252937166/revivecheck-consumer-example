# ReviveCheck consumer example: a DEX allow-list

A second, independent consumer of [ReviveCheck](https://github.com/a252937166/ReviveCheck), built outside its source tree to answer one assessment question: can the library be installed from a reproducible package artifact and used by a clean project through nothing but its documented interfaces?

The consumer is a DEX allow-list for one token, pUSD on the Portaldot V3 testnet. The token is on the list only while two things hold at once:

1. this repository's **own policy** (`config/allowlist.json`) evaluates the bound release to `valid`, and
2. the entry the list publishes equals, field by field, the entry the approved report verified on-chain through both interfaces.

Everything is read-only. No key is held, nothing is signed, no transaction is sent.

## What is in the box

| Path | What |
| --- | --- |
| `vendor/revivecheck-0.3.0.tgz`, `vendor/CHECKSUMS.txt` | the package artifact produced with `npm pack` from the ReviveCheck checkout, with its SHA-256 |
| `package.json`, `package-lock.json` | depends on `"revivecheck": "file:vendor/revivecheck-0.3.0.tgz"`; Node 22 |
| `config/allowlist.json` | the allow-list configuration: the policy, the release it relies on, the entry the operator intends to publish, and who controls each role |
| `src/check.js` | the command: live (reads the chain) or offline (`--fixture`) |
| `src/allowlist.js` | the allow-list rule, derived from the approved report; the consumer's own implementation on the public interfaces |
| `fixtures/*.json` | raw reads captured live on the testnet, labelled with provenance, for the refusal cases |
| `scripts/import-capture.js` | how the fixtures were derived from the upstream captures |
| `test/allowlist.test.js` | the refusal cases, run with `node --test` |
| `.github/workflows/allowlist.yml` | CI: `npm ci`, `npm test`, fixture checks that must pass and must fail |
| `out/` | the outputs of the one live run recorded on 2026-10-25 |
| `ONBOARDING_LOG.md` | the honest log of this clean-environment run |

## Install from scratch

```sh
git clone <this repository> revivecheck-consumer-example
cd revivecheck-consumer-example
node -v                                   # v22 or later
shasum -a 256 -c vendor/CHECKSUMS.txt     # Linux: cd vendor && grep -v '^#' CHECKSUMS.txt | sha256sum -c -
npm ci                                    # installs revivecheck from vendor/revivecheck-0.3.0.tgz
npm test                                  # offline refusal cases
```

The package artifact:

| | |
| --- | --- |
| File | `vendor/revivecheck-0.3.0.tgz` |
| SHA-256 | `e93c32da088e653f4d30708f523994e53f4fae85eb4f95f15e843493d75c9177` |
| Size | 97,699 bytes packed, 338,308 bytes unpacked, 38 files |
| Produced | 2026-10-25T09:51:24Z with `npm pack --pack-destination <this repo>/vendor` inside the ReviveCheck checkout (branch `redesign/custody-record`, HEAD `4dfb1e3` **with uncommitted working-tree changes**, see the caveat below) |
| Contents | `lib/`, `contracts/*.sol`, `contracts/deployed/v1/`, `mcp/`, `scripts/revivecheck.js`, `docs/API.md`, `docs/POLICY.md`, `docs/INTEGRATION.md`, `README.md`, `LICENSE`, `package.json` |

`"private": true` in the upstream manifest did not stop `npm pack`; only `npm publish` is blocked by it. The install resolved 233 packages (388 MB) in 23 seconds, because the library manifest declares its web UI and server dependencies (React, Express, lucide-react, fontsource, qrcode, solc, `@polkadot/extension-dapp`) as runtime dependencies. A headless consumer carries them without using them.

To rebuild the artifact yourself: check out the ReviveCheck repository at the state you want, run `npm pack --pack-destination <path>` there, and compare the SHA-256. The hash above identifies exactly the artifact this repository was tested against.

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

# Options: --config <file>, --out <dir> (default out), --now <ISO time>, --retries <n> (live, default 3)
```

The packaged CLI is also on the path after install: `npx revivecheck --help` lists the thirteen read-only tools.

### What the live command does, step by step

1. Loads `config/allowlist.json`, validates the policy with `normalizePolicy` and computes `policyHash`.
2. **Fetches the report from the chain**: `retrieveEvidence({ extrinsicHash, blockHash, expectedHash })` reads the `remark.store` extrinsic named in the configuration, checks the `Remark.Stored` event, recomputes the report's SHA-256 and compares it with the expected hash. No report file is copied from any workspace; the report is the one the release owner stored on-chain.
3. Creates this consumer's binding with `createBinding({ policy, report, releaseId, revision, boundBy, note, storage })`: this policy, this exact report, release `pusd-catalog-v2` revision 2.
4. `collectPolicyInputs({ policy, binding })` reads, at one finalized block each, the network observation, the ReleaseRegistry (release state and the decision of every trusted reviewer) and the VerifiedTokenList v2 listing through both the EVM RPC and ReviveApi, and retrieves the stored report again as evidence.
5. `evaluateBinding({ policy, binding, report, observation, registry, listing, evidence, now })` returns the `revivecheck.policy-evaluation.v1` document.
6. `src/allowlist.js` derives the entry from the approved report (`approvedEntry`), compares it with the configured entry (`compareEntry`) and writes the allow-list.
7. Writes `out/allowlist.json`, `out/evaluation.json` and `out/inputs.json`, then `closeConnections()`.

When a public node does not answer, the command retries up to `--retries` times and records every attempt in `out/inputs.json`. An evaluation whose reads failed is `unknown`, denied, exit 1.

## Interfaces and schemas used

From the installed package, by subpath export:

| Import | Used for |
| --- | --- |
| `revivecheck/policy` | `normalizePolicy`, `policyHash`, `createBinding`, `evaluateBinding`, `summarizeEvaluation` (and `verifyBinding`, `REASONS` in the tests) |
| `revivecheck/service` | `retrieveEvidence`, `collectPolicyInputs`, `closeConnections` (the tests also assert `evaluatePolicy`, `readRegistry`, `readTokenList`, `networkStatus` are exported) |
| `revivecheck/report` | `verifyRun`, `fingerprint` (and `validateImportedRun`, `canonical` asserted present) |
| `revivecheck/package.json` | the installed version |

All fourteen export specifiers in the upstream manifest (`revivecheck`, `./policy`, `./service`, `./report`, `./registry`, `./tokenlist`, `./networks`, `./chain`, `./evidence`, `./plan`, `./demo`, `./lib/*`, `./contracts/*`, `./package.json`) resolved from the tarball; see the onboarding log.

Documents, as defined in the package's `docs/POLICY.md`:

- **`revivecheck.policy.v1`**: authored here, in `config/allowlist.json`. Network testnet (chain 420420777, genesis `0xd4f9acbc…283bd`), runtime `portaldot-v3/3002`, subject native asset 7777 at `0x00001e6100000000000000000000000000010000`, plan hash `ce76c98f…2191`, evidence scope `portaldot-testnet-readonly` with `maxAgeSeconds` 604800, `maxObservationAgeSeconds` 900, `requireInterfacesAgree` and `requireStoredOnChain` true, trusted reviewers `[0x95db300103ec8b45884b13ed85230fbf02114065]` with threshold 1 and a basis text stating that the reviewer and the release owner are both project-controlled, registry `0xe949b200edf070b9d425b206ed24dc8fe5b7d339` with owner `0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b` and label `pusd-catalog-v2`, consumer `0xedaf8a25bb583ad164a94191b762414277198df9` version 2 with `requireListed` true. Its hash is `795942d67b86c2c9b35c07fe3e24f2d8796dbd01ea79806b35cf125aaf44f8c3`, which differs from the upstream example catalog's policy (`ce1388f9…34fd`): same subject, different author, different text.
- **`revivecheck.binding.v1`**: created at run time by `createBinding`, never stored as configuration. The live binding is in `out/allowlist.json` (`binding`) and `out/inputs.json`.
- **`revivecheck.policy-evaluation.v1`**: `out/evaluation.json`, self-hashed (`evaluationHash`).

This repository's own documents: `revivecheck-consumer.config.v1` (configuration), `revivecheck-consumer.fixture.v1` (captured reads with provenance), `revivecheck-consumer.inputs.v1` (what a run read, replayable), and the output:

```json
{
  "schema": "revivecheck-consumer.allowlist.v1",
  "allow": [{ "chainId": 420420777, "address": "0x00001e61…10000", "symbol": "pUSD", "name": "Portaldot USD (test)", "decimals": 6, "assetId": "7777", "source": "approved-report", "reportHash": "1faef921…", "releaseId": "0x28ab8a86…", "revision": "2", "…": "…" }],
  "denied": [{ "address": "…", "status": "recheck-required | expired | unknown | valid", "reasons": ["<policy reason codes>", "entry-mismatch:<field>"], "nextAction": "…" }],
  "evaluatedAt": "…", "checkpoints": { "registry": {}, "observation": {}, "listing": {}, "storage": {}, "report": {} },
  "policyHash": "…", "evaluationHash": "…", "binding": {}, "reviewerTrust": "…", "roles": {}, "rule": "…", "caveat": "…"
}
```

`reasons` lists the evaluation's reason codes (every code is in `REASONS` of `revivecheck/policy`) followed by this consumer's own `entry-mismatch:<field>` or `entry-unverified`. The published fields in `allow` come from the approved report, not from the configuration: a configuration that disagrees with the report withholds the entry and names the field.

## The refusal cases (`npm test`)

| Scenario | Fixture | Result |
| --- | --- | --- |
| Approved revision 2, correct entry | `valid-r2.json` | **allowed**, exit 0, `valid` |
| Wrong decimals in the configuration (18 instead of 6) | `valid-r2.json` with `config-wrong-decimals.json` | denied, `entry-mismatch:decimals`; the policy evaluation itself is `valid` |
| Binding names revision 1 / `eb960cc7…` while the registry holds revision 2 | `superseded-r1.json` | denied, `recheck-required`: `revision-superseded`, `approval-missing`, `consumer-not-listed` |
| Trusted reviewer requested changes | `revoked-r2.json` | denied, `recheck-required`: `approval-revoked`, `consumer-not-listed` |
| Every read replaced by `{ error }` | `unavailable.json` | denied, `unknown`: `observation-missing`, `registry-unavailable`, `consumer-unavailable`, `storage-unverified` |
| Evaluated eight days after the capture | `valid-r2.json --now 2026-11-02T09:43:18.329Z` | denied, `expired`: `evidence-expired`, `observation-stale` |

The fixtures reuse raw reads (network observation, registry read, consumer listing, stored-evidence retrieval with the report it returned) that the upstream ReviveCheck example catalog captured live on 2026-10-25 under its own policy. The upstream capture wrapper and its policy hash are recorded as provenance in each fixture and are not used for anything: this consumer evaluates the raw reads under its own policy with a binding it creates itself, which is what `evaluateBinding` accepts. `scripts/import-capture.js` is the exact derivation. The `unavailable` fixture is `valid-r2` with every read replaced by an error object.

## The live run recorded here

`out/` holds the one live run performed while building this repository, on 2026-10-25 (`npm run check`, 22 seconds wall clock, first attempt):

| | |
| --- | --- |
| Verdict | **ALLOWED**, exit 0; evaluation `valid`, 35 of 35 checks passed |
| Evaluated at | 2026-10-25T09:59:21.688Z |
| Checkpoint | finalized block #187437 (`0x48711c27…bd3c3`) for the registry read, the network observation and the listing |
| Report | `1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51`, retrieved from extrinsic `0x80d46a86…feb3` in block #187145, publisher `5GH8LpSTf6sp31FeacbFE99E3b9NQb5E7xWHeBL8XqW3YhTt`, 7,404 bytes, report checkpoint #187136 |
| Registry | `pusd-catalog-v2` revision 2 owned by `0x48b9…a71b`, report hash as bound, reviewer `0x95db…4065` reviewed and approved, interfaces agree |
| Listing | VerifiedTokenList v2 lists the subject on this release, report and reviewer; `version()` 2 through both interfaces |
| Policy hash | `795942d67b86c2c9b35c07fe3e24f2d8796dbd01ea79806b35cf125aaf44f8c3` |
| Evaluation hash | `c799567e1c76991101fd586f3f71372c1159fc15bd1678809c22858bd7bc749b` |
| Binding hash | `eb2dcbd86e16c4ddbdaf0710958edd91628d7607aa4879f5d78f6cb343aa0b9e` |

`out/inputs.json` records the raw reads of that run, so it can be replayed offline exactly as the fixtures are.

## Expiry

`maxAgeSeconds` is 604800 (seven days), evaluated off-chain from the report's `completedAt` and the evaluator's clock. The bound report completed at 2026-10-25T09:29:17.646Z, so from **2026-11-01T09:29:17Z** this allow-list evaluates `expired` and denies the entry, even though nothing on the chain changes: the registry still holds the approval and the VerifiedTokenList still lists the token. To keep the token listed past that date the release owner has to check the release again, a trusted reviewer has to approve the new report's exact hash, and the configuration here has to name the new report, revision and storage extrinsic. The old report, binding and evaluation stay as history. The sixth test demonstrates the consequence with the captured reads and a shifted clock.

## What this proves, and what it does not

It proves:

- **Portability.** The library installs from a packed tarball in a project with no access to the source tree, and the documented subpath exports resolve and work.
- **A second use of the documented interface.** This consumer is distinct from the upstream `examples/token-catalog/` (which is not in the package) and implements the business rule with `revivecheck/policy`, `revivecheck/service` and `revivecheck/report` only. The bound report is fetched from chain data at run time, not copied from a workspace.
- **Refusals are real.** Each refusal case runs through the actual command and exits non-zero; CI checks both directions.

It does not prove:

- **An external builder.** This repository was built by an AI agent on the ReviveCheck author's machine, with the author's checkout available for reading. Where the documentation did not state a function signature, the agent read library source; `ONBOARDING_LOG.md` lists every such instance as author assistance. Nobody outside the project has repeated this.
- **Adoption.** No third party runs this list.
- **Independent review.** The trusted reviewer (`0x95db…4065`) and the release owner (`0x48b9…a71b`) are both accounts controlled by the ReviveCheck project. The on-chain record shows role separation between two signers, nothing more; the policy's `basis` text says so and is copied into every evaluation.
- **A tagged source state.** The tarball was packed from a working tree with uncommitted changes (HEAD `4dfb1e3` plus modifications). Its SHA-256 identifies the artifact precisely, but no upstream commit or tag reproduces it byte for byte yet.
- **RPC honesty or future state.** The evaluator trusts the public nodes it reads, and a `valid` result is a point-in-time statement; evaluate again before each use.

## CI

`.github/workflows/allowlist.yml` runs on push, pull request and manual dispatch: verify the tarball checksum, `npm ci`, `npm test`, the `valid-r2` fixture check (must pass), the three refusal fixtures and the wrong-decimals configuration (must fail), and keeps the outputs as an artifact. A separate manual `live` job runs `npm run check` against the public nodes and fails when they do not answer. The workflow becomes inspectable only after this repository is pushed to a remote; at the time of writing it has not been pushed, so no run exists yet.

## Licence

MIT, see `LICENSE`. The vendored ReviveCheck package is MIT licensed by its own authors (`node_modules/revivecheck/LICENSE` after install).
