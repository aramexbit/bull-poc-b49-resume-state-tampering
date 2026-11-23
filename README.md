# Bull SDK `settleStateMessage`: `request.*` outside `stateMac` lets a stored settle state resume with an attacker arbiter

**Report:** B-49 (Minor) — Bull.family bug bounty
**Location:** SDK `settleStateMessage` / `verifySettleState` / `runSettleMachine` — https://www.bull.family/sdk/bull.mjs (version pinned here, sha256 `b6e7d25c91d1a77f324ec1e97109f01e5ba5110f52f5f1f949fd5ab7d09afe2b`, 164,314 B). `settleStateMessage` ~line 408, `verifySettleState` ~line 413. Agreement v4.1 `0x7AB58fAAe65eFCF0037635382cAA546EaC233DA6` (Robinhood Chain 4663).
**Severity:** Minor (honestly Minor — demonstrated loss is $25, bounded by the state's amount, and it requires access to the stored state JSON)
**Wallet for the reward:** 0x0F9B5396B89c2fFc1A204B988dFd8DF7Be418d56
**Contact:** X @brian_byar17103

**HISTORICAL CLAIM:** this bug was found and proven against SDK `b6e7d25c` (22 Nov 2026). SDK `c81ec058` (deployed 23 Nov 2026) signs `request.*` canonically in the state MAC, so this PoC reproduces only against the pinned SDK file in this repo, not against the live SDK. Filed as a historical claim against the version it was found on.

## What is the bug?

`settleStateMessage` — the message the buyer's wallet signs as `stateMac` so "a tampered or foreign state is refused on resume" — does NOT include `st.request`. `request` is the release condition the settlement will actually execute (`template`, `arbiter`, `terms`, `expiryHours`, `params`). `verifySettleState` recovers the signer from exactly this message, so a state whose `request.arbiter` was swapped to an attacker (or whose `template` was swapped to `optimistic`) still verifies as the buyer's own state. The MAC works fine for everything it covers — `amount`, `needRaw`, `planDigest`, `policy`, `bridge`, `chain`, `seller` tampering is all refused with `state_tampered` (K-4634–K-4638, controls) — but the release condition itself is unsigned.

`runSettleMachine` then resumes the tampered state and calls `openAgreement` with the tampered `request`. Its `verifyOpen` checks payee, payer, amount, asset, status, the `settle:<id>` terms hash and `conditionsOk` — but the terms hash covers only the terms *text*, and `conditionsOk` is evaluated against the (tampered) request the machine itself carries. Nothing binds the opened agreement back to the arbiter/template the buyer originally signed. So a stored settle state resumed after its `request.arbiter` is swapped opens an `arbiter_escrow` agreement whose arbiter is the attacker — who then attests and releases the funds to the seller without any delivery.

Threat model: anyone who can modify the persisted state JSON between `settle` and `resume` (compromised or stale API storage, a shared state file, a sync layer) — no victim private key needed, no action beyond the normal resume flow.

## How to reproduce

`bash run.sh` — exits 0 when the bug reproduces. Local only: fresh Anvil 4663 per node mode, mock API, live SDK `b6e7d25c` verbatim (pinned `sdk-live.mjs`). No mainnet, no real funds, no Bull infrastructure.

- **Leg 1 — pure** (`test-settle-pure-minor19.mjs`, 38 cases, exit 0): a buyer-signed state (`request: { template: "arbiter_escrow", arbiter: 0x7777… (honest), terms: "Deliver the report", expiryHours: 72 }`, amount `"25"`, needRaw `"25000000"`). With the SAME `stateMac`, `request.arbiter` swapped to `0x3333333333333333333333333333333333333333` is ACCEPTED (`tamperedArbiterAccepted: true`); `template` swapped to `optimistic` is ACCEPTED (`tamperedTemplateAccepted: true`); control (honest state) passes; `amount` `"25"`→`"26"` is refused with `state_tampered` (`tamperedAmountRefused: true`).
- **Leg 2 — machine** (same file, stub io): resume at phase `"opening"` with the tampered state reaches `done`; `openAgreement` is called with `template: "arbiter_escrow"`, `arbiter: 0x3333…`, `amount: "25"`; agreement id `"7"` recorded (`machineDone: true`, `openedArbiterIsAttacker: true`). Control: the honest state opens with the honest arbiter (`openedArbiterIsHonest: true`).
- **Leg 3 — on-chain** (node mode `k4621`, `run-sdk-b46.mjs`, fresh Anvil, live Agreement v4.1 bytecode etched zerofee): `deal("arbiter_escrow", { payee, asset: "usdg", amount: "25", arbiter: 0x3333…, terms: "Deliver the report", expiryHours: 72 })` — the exact call the resumed machine makes — sends (`sdkSent: true`, agreement id `"7"`, `agreementIdIs7: true`); the attacker arbiter (impersonated `0x3333…`) attests (`attackerArbiterAttested: true`); `release` succeeds (`released: true`); the seller gains exactly 25 USDG and the payer loses exactly 25 USDG (`sellerGainedUsdg: "25"`, `payerLostUsdg: "25"`, `sellerPaid25WithoutDelivery: true`). Executed twice during the audit (22 Nov 2026 22:35:28 and 22:35:36 WIB) with byte-identical results; first run preserved as `node-result-k4621-first.json`.

**Honest caveat:** a forge `.t.sol` test for the full resume→attest→release chain does NOT exist. Writing it was refused by the safety policy twice — both times the write was stopped at that point, not retried, reworded or circumvented. The on-chain leg is therefore proven at node level on live bytecode (fresh Anvil), not at forge level, and the resume leg at machine level with stub io.

**Controls (same pure run):** K-4631 — `request.terms` tamper is accepted by `verifySettleState` but `verifyOpen` HALTS with `agreement_mismatch` (the on-chain terms hash was computed from the original terms) — fail-closed, which is exactly the second check `arbiter`/`template` lack. K-4632 — `state.plan` tamper is accepted but `plan` is display-only with no runtime consumer. K-4634–K-4639 — every MAC'd field tampered is refused (`state_tampered`) or halts (`agreement_mismatch`).

## Impact

In the demonstrated state the buyer/payer loses $25: the seller is paid 25 USDG with no delivery, because the only party who can attest delivery is the attacker. The loss is bounded by the state's `amount` (here $25) and requires access to the stored state JSON — it does not require the victim's key, and the tampered state still carries the victim's own valid signature, so nothing in the resume flow flags it. The same root cause also lets the template be swapped (`arbiter_escrow`→`optimistic`, K-4633, folded here). This is Minor, not Major: the demonstrated amount is $25, the attack needs state access (not just a malicious server response), and the fix is a one-line MAC coverage change.

## Suggested fix

Include `request` in the signed core: add `request: { template, arbiter, termsHash, expiryHours, paramsHash }` (or the whole `request` object, canonicalised) to `settleStateMessage`'s `core`, and bump the state version so old states re-sign. Defence in depth: in `runSettleMachine`'s `verifyOpen`, check that the opened agreement's arbiter-condition target equals the `request.arbiter` from the signed state (the way it already checks payee/payer/amount/asset/termsHash).

## Dedupe

- **Not K-4483.** Same function, same "outside `stateMac`" observation — but a different field with a different outcome: `amountUsd` is display-only; `needRaw` (the amount that actually moves) IS covered by the MAC, so tampering `amountUsd` cannot move one extra cent. Here the tampered field (`request.arbiter`/`template`) IS executed — `openAgreement` consumes it directly — and $25 demonstrably moves.
- **Not B-23.** B-23 is `deal()` never verifying the data/value of server-supplied conditions at deal time. This is resume-time integrity of a buyer-signed state.
- **Not B-46.** B-46 is `deal()` never comparing expiry to the requested `expiryHours`. Different check, different harm (delayed refund vs attacker-controlled release), different fix.
- **Folded into this report:** K-4633 — template swap `arbiter_escrow`→`optimistic` at resume; same root cause, same fix.
- **Dedupe risk, stated honestly:** LOW-MEDIUM (see the full draft for the K-4483 counter-arguments).
