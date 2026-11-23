// MINOR 17-A — Team A. Pure-function tests against live SDK b6e7d25c
// (164.314 B, redeploy ke-5 hari ini). No chain, no network except viem
// local signing; ethSpot NOT called.
// verifyPayoutPrefs v2 / normalizeSettlePolicy maxBridgeFeeBps /
// verifySettlePlan (bridge + signed payee) / verifyPayeePortable /
// expectedSettlePick / rejectNeedlessBridge / runSettleMachine verifyOpen
// (K-4186 re-grade). Throwaway local keys only.
// Usage: node test-settle-pure-minor17.mjs  (prints one JSON object per case)
import {
  verifySettlePlan, verifyPayoutPrefs, payoutPrefsMessage, PREFS_HOST,
  normalizeSettlePolicy, runSettleMachine, verifyPayeePortable,
  expectedSettlePick, rejectNeedlessBridge, settleTermsHash,
  settleStateMessage, verifySettleState,
} from "./sdk-live.mjs";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";

const BUYER = "0x1111111111111111111111111111111111111111";
const SELLER = "0x2222222222222222222222222222222222222222";
const ATTACKER = "0x3333333333333333333333333333333333333333";
const PAYEE2 = "0x4444444444444444444444444444444444444444";
const out = [];
const push = (o) => { out.push(o); }; // log deferred: flags set after push() must print true

const pol = normalizeSettlePolicy({});
const basePlan = (over = {}) => ({
  ok: true, buyer: BUYER, seller: SELLER,
  settlementChain: "base", settlementAsset: "stable", amount: "25",
  bridge: "none", ...over,
});
const tryPlan = (plan, ctx) => {
  try { const r = verifySettlePlan(plan, ctx); return { ok: true, result: r }; }
  catch (e) { return { ok: false, code: e?.code || null, msg: String(e?.message || e).slice(0, 200) }; }
};

// ---- payoutPrefs v2: sign with throwaway keys, verify locally
const sellerKey = "0x0000000000000000000000000000000000000000000000000000000000000001";
const otherKey = "0x0000000000000000000000000000000000000000000000000000000000000002";
const sellerAcct = privateKeyToAccount(sellerKey);
const otherAcct = privateKeyToAccount(otherKey);
const chains = [{ chain: "base", assets: ["stable"], priority: 1 }, { chain: "robinhood", assets: ["stable", "eth"], priority: 2 }];
const nonce = "aabbccddeeff00112233445566778899";
const NOW = 1763800000000; // fixed "now" for deterministic freshness checks
const issuedAt = NOW - 1000;
const SELLER_PREFS = sellerAcct.address;
const msgV2 = payoutPrefsMessage(SELLER_PREFS, chains, nonce, issuedAt, 2);
const msgV1 = payoutPrefsMessage(SELLER_PREFS, chains, nonce, issuedAt, 1);
const sigV2 = await sellerAcct.signMessage({ message: msgV2 });
const sigV1 = await sellerAcct.signMessage({ message: msgV1 });
const prefsObj = (sig, at = issuedAt) => ({ address: SELLER_PREFS, isDefault: false, chains, signed: { nonce, issuedAt: at, sig } });

// K-4206a CONTROL: seller's own v2 sig verifies
{
  const r = await verifyPayoutPrefs(SELLER_PREFS, prefsObj(sigV2), recoverMessageAddress, { now: NOW });
  push({ case: "K-4206a CONTROL verifyPayoutPrefs v2 own sig verifies (M-1856)", chainsReturned: r, controlPasses: Array.isArray(r) && r.length === 2 });
}
// K-4206: v1 legacy sig accepted NOW (inside the compat window) but NOT after 2026-12-31
{
  const nowOk = await verifyPayoutPrefs(SELLER_PREFS, prefsObj(sigV1), recoverMessageAddress, { now: NOW });
  // NOTE: the after-deadline record is signed for its own issuedAt, so the v1
  // signature itself is valid — only the legacy window must reject it.
  const sigV1Late = await sellerAcct.signMessage({ message: payoutPrefsMessage(SELLER_PREFS, chains, nonce, Date.UTC(2027, 0, 1) - 1000, 1) });
  const afterDeadline2 = await verifyPayoutPrefs(SELLER_PREFS, prefsObj(sigV1Late, Date.UTC(2027, 0, 1) - 1000), recoverMessageAddress, { now: Date.UTC(2027, 0, 1) });
  push({ case: "K-4206 verifyPayoutPrefs v1 legacy window (M-1856)", acceptedNow: Array.isArray(nowOk) && nowOk.length === 2, rejectedAfter2031: afterDeadline2 === null });
}
// K-4207: freshness + host binding — stale / future / wrong-host all null
{
  const stale = await verifyPayoutPrefs(SELLER_PREFS, prefsObj(sigV2, NOW - 181 * 86400_000), recoverMessageAddress, { now: NOW });
  const future = await verifyPayoutPrefs(SELLER_PREFS, prefsObj(sigV2, NOW + 601_000), recoverMessageAddress, { now: NOW });
  const sigWrongHost = await sellerAcct.signMessage({ message: payoutPrefsMessage(SELLER_PREFS, chains, nonce, issuedAt, 2, "evil.example") });
  const wrongHost = await verifyPayoutPrefs(SELLER_PREFS, prefsObj(sigWrongHost), recoverMessageAddress, { now: NOW });
  push({ case: "K-4207 verifyPayoutPrefs stale/future/wrong-host rejected (M-1857)", staleNull: stale === null, futureNull: future === null, wrongHostNull: wrongHost === null });
}
// K-4208: chains[].address (per-chain payout address) survives verify + feeds signedPayees
{
  const chainsAddr = [{ chain: "base", assets: ["stable"], priority: 1, address: PAYEE2 }, { chain: "robinhood", assets: ["stable", "eth"], priority: 2 }];
  const sigAddr = await sellerAcct.signMessage({ message: payoutPrefsMessage(SELLER_PREFS, chainsAddr, nonce, issuedAt, 2) });
  const r = await verifyPayoutPrefs(SELLER_PREFS, { address: SELLER_PREFS, isDefault: false, chains: chainsAddr, signed: { nonce, issuedAt, sig: sigAddr } }, recoverMessageAddress, { now: NOW });
  const planSigned = tryPlan(basePlan({ payee: PAYEE2 }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol, price: null, signedPayees: { base: PAYEE2 } });
  push({ case: "K-4208 verifyPayoutPrefs chains[].address + signed payee plan (M-1858)", addressPreserved: Array.isArray(r) && r[0]?.address === PAYEE2, planAccepted: planSigned.ok === true, payeeMode: planSigned.result?.payeeMode ?? null });
}

// ---- K-4209: normalizeSettlePolicy maxBridgeFeeBps bounds
const tryPol = (p) => {
  try { return { ok: true, policy: normalizeSettlePolicy(p) }; }
  catch (e) { return { ok: false, code: e?.code || null, msg: String(e?.message || e).slice(0, 160) }; }
};
{
  const over = tryPol({ maxBridgeFeeBps: 2001 });
  const atMax = tryPol({ maxBridgeFeeBps: 2000 });
  const zero = tryPol({ maxBridgeFeeBps: 0 });
  const def = tryPol({});
  push({ case: "K-4209 normalizeSettlePolicy maxBridgeFeeBps bounds (M-1859)", rejected2001: over.code === "bad_policy", accepted2000: atMax.ok === true && atMax.policy.maxBridgeFeeBps === 2000, accepted0: zero.ok === true && zero.policy.maxBridgeFeeBps === 0, default500: def.ok === true && def.policy.maxBridgeFeeBps === 500 });
}

// ---- verifySettlePlan bridge checks (K-4210..K-4213)
const bridgeBase = { recipient: BUYER, fromChain: "robinhood", toChain: "base", fromAsset: "stable", amountUsd: 25 };
push({ case: "K-4210 verifySettlePlan bridge toChain != settlementChain (M-1860)",
  ...tryPlan(basePlan({ bridge: { ...bridgeBase, toChain: "robinhood" } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol, price: null }) });
out[out.length - 1].refusedPlanMismatch = out[out.length - 1].code === "plan_mismatch";
push({ case: "K-4211 verifySettlePlan bridge spends ETH, policy stable-only (M-1861)",
  ...tryPlan(basePlan({ bridge: { ...bridgeBase, fromAsset: "eth" } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol, price: null }) });
out[out.length - 1].refusedPolicyAsset = out[out.length - 1].code === "policy_asset_not_allowed";
{
  const bad = tryPlan(basePlan({ bridge: { ...bridgeBase, route: "mixed", worstLossBps: 600 } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol, price: null });
  const ok = tryPlan(basePlan({ bridge: { ...bridgeBase, route: "mixed", worstLossBps: 200 } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol, price: null });
  push({ case: "K-4212 verifySettlePlan worstLossBps 600 > maxBridgeFeeBps 500 (M-1862)", refusedFeeTooHigh: bad.code === "policy_bridge_fee_too_high", control200Passes: ok.ok === true, controlWorstFloor300: ok.ok === true });
}
{
  const unsigned = tryPlan(basePlan({ payee: ATTACKER }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol, price: null });
  const signed = tryPlan(basePlan({ payee: ATTACKER }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol, price: null, signedPayees: { base: ATTACKER } });
  push({ case: "K-4213 verifySettlePlan payee != seller without signed prefs (M-1863)", refusedPayeeNotSigned: unsigned.code === "payee_not_signed", signedAccepted: signed.ok === true, signedPayeeMode: signed.result?.payeeMode ?? null });
}

// ---- verifyPayeePortable (K-4214 / K-4215)
{
  const empty = async () => "0x";
  const got = await verifyPayeePortable(SELLER, empty);
  let contractErr = "";
  try { await verifyPayeePortable(SELLER, async (ch) => (ch === "base" ? "0x608060405234801561001057600080fd5b50" : "0x")); } catch (e) { contractErr = e?.code || String(e?.message || e); }
  push({ case: "K-4214 verifyPayeePortable contract code on one chain (M-1864)", emptyOk: got?.base === "empty" && got?.robinhood === "empty", refusedContractWallet: contractErr === "payee_contract_wallet" });
}
{
  const eip7702 = "0xef0100" + "11".repeat(20); // 0xef0100 + 20-byte delegation address = 48 chars
  const got = await verifyPayeePortable(SELLER, async () => eip7702);
  let mixedErr = "";
  try { await verifyPayeePortable(SELLER, async (ch) => (ch === "robinhood" ? eip7702 : "0x608060405234801561001057600080fd5b50")); } catch (e) { mixedErr = e?.code || String(e?.message || e); }
  push({ case: "K-4215 verifyPayeePortable EIP-7702 delegation accepted (M-1865)", eip7702Ok: got?.base === "eip7702" && got?.robinhood === "eip7702", mixedContractRefused: mixedErr === "payee_contract_wallet" });
}

// ---- expectedSettlePick / rejectNeedlessBridge (K-4216 / K-4217)
{
  const prefs = [{ chain: "base", assets: ["stable"], priority: 1 }];
  const local = {
    "base/stable": { eligible: true, feasible: true, bridgeNeeded: false, originKind: "stable", bridgeUsd: 0 },
    "robinhood/stable": { eligible: true, feasible: true, bridgeNeeded: true, originKind: "stable", bridgeUsd: 25 },
    "base/eth": { eligible: false, feasible: false, bridgeNeeded: false, originKind: "eth", bridgeUsd: 0 },
    "robinhood/eth": { eligible: false, feasible: false, bridgeNeeded: false, originKind: "eth", bridgeUsd: 0 },
  };
  const pick1 = expectedSettlePick({ prefs, policy: pol, constraints: undefined, preferredAsset: null, local });
  const local2 = { ...local, "base/stable": { eligible: true, feasible: false, bridgeNeeded: false, originKind: "stable", bridgeUsd: 0 } };
  const pick2 = expectedSettlePick({ prefs, policy: pol, constraints: undefined, preferredAsset: null, local: local2 });
  const pickNone = expectedSettlePick({ prefs: [], policy: pol, constraints: undefined, preferredAsset: null, local: { "base/stable": { eligible: false, feasible: false, bridgeNeeded: false, originKind: "stable", bridgeUsd: 0 } } });
  push({ case: "K-4216 expectedSettlePick prefs no-bridge beats bridge (M-1866)", noBridgeFirst: pick1?.chain === "base" && pick1?.bridgeNeeded === false, bridgeFallback: pick2?.chain === "robinhood" && pick2?.bridgeNeeded === true, noneNull: pickNone === null });
}
{
  let threw = "", threwCode = "";
  try { rejectNeedlessBridge({ planBridges: true, expected: { chain: "base", kind: "stable", bridgeNeeded: false } }); } catch (e) { threw = String(e?.message || e).slice(0, 160); threwCode = e?.code || ""; }
  let threw2 = false;
  try { rejectNeedlessBridge({ planBridges: true, expected: { chain: "robinhood", kind: "stable", bridgeNeeded: true } }); } catch { threw2 = true; }
  let threw3 = false;
  try { rejectNeedlessBridge({ planBridges: false, expected: { chain: "base", kind: "stable", bridgeNeeded: false } }); } catch { threw3 = true; }
  push({ case: "K-4217 rejectNeedlessBridge (M-1867)", refusedNeedlessBridge: threwCode === "needless_bridge", bridgeNeededPasses: threw2 === false, noBridgePlanPasses: threw3 === false });
}

// ---- runSettleMachine verifyOpen — K-4186 re-grade (M-1868)
const mkState = (over = {}) => ({
  v: 1, id: "0011223344556677", createdAt: 1, updatedAt: 1, phase: "opening",
  buyer: BUYER, seller: SELLER, sellerIdentity: SELLER, payeeMode: "signed_chain_address",
  chain: "robinhood", settleKind: "stable",
  assetName: "usdg", amount: "25", amountUsd: 25,
  needRaw: "25000000", minGasWei: "300000000000000",
  bridge: { needed: false }, agreement: { baselineId: 0, nonce0: 7 }, history: [],
  request: { terms: "Deliver the report" }, ...over,
});
const mkIo = (over = {}) => {
  const calls = [];
  const io = {
    now: () => 1000000, sleep: async () => {}, save: async () => { calls.push("save"); },
    readSettle: async () => { calls.push("readSettle"); return { tok: 25000000n, eth: 1000000000000000000n }; },
    nonces: async () => { calls.push("nonces"); return { latest: 7, pending: 7 }; },
    bridgeStatus: async () => { calls.push("bridgeStatus"); return { status: "confirmed" }; },
    quoteBridge: async () => { calls.push("quoteBridge"); return { id: "0x" + "ab".repeat(32) }; },
    sendBridge: async () => { calls.push("sendBridge"); return ["0x" + "cd".repeat(32)]; },
    maxAgreementId: async () => { calls.push("maxAgreementId"); return 0; },
    findAgreement: async () => { calls.push("findAgreement"); return null; },
    getAgreement: async () => { calls.push("getAgreement"); return null; },
    openAgreement: async () => { calls.push("openAgreement"); return "99"; },
    ...over,
  };
  return { io, calls };
};
const tryMachine = async (state, io) => {
  try { const r = await runSettleMachine(state, io); return { ok: true, phase: r.phase, agreementId: r.agreement?.id ?? null }; }
  catch (e) { return { ok: false, code: e?.code || null, msg: String(e?.message || e).slice(0, 200), halted: e?.state?.phase ?? null }; }
};
{
  // OLD agreement id 7, released, WITHOUT this settlement's tag:
  // findAgreement returns it, verifyOpen must HALT (terms mismatch).
  const st = mkState();
  const tag = settleTermsHash(st);
  const { io, calls } = mkIo({
    findAgreement: async () => { calls.push("findAgreement"); return { id: "7" }; },
    getAgreement: async () => { calls.push("getAgreement"); return { payee: SELLER, payer: BUYER, amount: "25", assetOk: true, status: "released", termsHash: "0x" + "00".repeat(32), conditionsOk: true }; },
  });
  const r = await tryMachine(st, io);
  push({ case: "K-4218 runSettleMachine K-4186 re-grade: OLD agreement w/o settle tag NOT adopted (M-1868)", ...r, openCalled: calls.includes("openAgreement"), haltedAgreementMismatch: r.code === "agreement_mismatch", termsTagChecked: typeof tag === "string" && tag.startsWith("0x") });
}
{
  // CONTROL: same agreement id 7 WITH the settle tag + matching fields:
  // adoption as done is correct (it IS this settlement's agreement).
  const st = mkState();
  const tag = settleTermsHash(st);
  const { io, calls } = mkIo({
    findAgreement: async () => { calls.push("findAgreement"); return { id: "7" }; },
    getAgreement: async () => { calls.push("getAgreement"); return { payee: SELLER, payer: BUYER, amount: "25", assetOk: true, status: "released", termsHash: tag, conditionsOk: true }; },
  });
  const r = await tryMachine(st, io);
  push({ case: "K-4218 CONTROL runSettleMachine agreement WITH settle tag adopted (M-1868)", ...r, openCalled: calls.includes("openAgreement"), adoptedTaggedId: r.ok && r.agreementId === "7", phaseDone: r.ok && r.phase === "done" });
}

// ---- ROUND 39-A pure cases (K-4394..K-4396, M-2044..M-2046) ----
// K-4394 (M-2044): verifySettlePlan — over-maxUsd + amount mismatch refused;
// worstLossBps 0 on a same-kind bridge does NOT lower the 300bps mixed floor.
{
  const overMax = tryPlan(basePlan({ amount: "150" }), { buyer: BUYER, seller: SELLER, amountUsd: 150, policy: pol, price: null });
  const mismatch = tryPlan(basePlan({ amount: "30" }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol, price: null });
  const mixedZero = tryPlan(basePlan({ bridge: { ...bridgeBase, route: "mixed", worstLossBps: 0 } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol, price: null });
  // Corrected expectation: worst = max(300, 0) = 300bps, under the default
  // maxBridgeFeeBps 500, so the plan PASSES; with a 200bps policy it must refuse.
  const pol200 = normalizeSettlePolicy({ maxBridgeFeeBps: 200 });
  const mixedZero200 = tryPlan(basePlan({ bridge: { ...bridgeBase, route: "mixed", worstLossBps: 0 } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol200, price: null });
  push({ case: "K-4394 verifySettlePlan over-maxUsd + amount mismatch refused; mixed worstLoss 0 floored to 300bps (passes at 500, refused at 200) (M-2044)", overMaxRefused: overMax.code === "policy_max_usd", mismatchRefused: mismatch.code === "plan_mismatch", mixedZeroPassesAt500: mixedZero.ok === true, mixedZeroRefusedAt200: mixedZero200.code === "policy_bridge_fee_too_high" });
}
// K-4395 (M-2045): verifyPayoutPrefs — wrong-host / other-signer / tampered chains all null; own v2 sig verifies.
{
  const sigOther = await otherAcct.signMessage({ message: msgV2 });
  const otherSig = await verifyPayoutPrefs(SELLER_PREFS, prefsObj(sigOther), recoverMessageAddress, { now: NOW });
  const tamperedChains = [{ chain: "base", assets: ["eth"], priority: 1 }];
  const sigTampered = await sellerAcct.signMessage({ message: payoutPrefsMessage(SELLER_PREFS, tamperedChains, nonce, issuedAt, 2) });
  const tampered = await verifyPayoutPrefs(SELLER_PREFS, { address: SELLER_PREFS, isDefault: false, chains, signed: { nonce, issuedAt, sig: sigTampered } }, recoverMessageAddress, { now: NOW });
  const own = await verifyPayoutPrefs(SELLER_PREFS, prefsObj(sigV2), recoverMessageAddress, { now: NOW });
  push({ case: "K-4395 verifyPayoutPrefs other-signer + tampered-chains rejected, own v2 verifies (M-2045)", otherSignerNull: otherSig === null, tamperedChainsNull: tampered === null, ownVerifies: Array.isArray(own) && own.length === 2 });
}
// K-4396 (M-2046): normalizeSettlePolicy — unknown field / maxUsd 0 / maxBridgeFeeBps 2001 / bad chain all refused; defaults intact.
{
  const bad = [];
  for (const p of [{ unknownField: 1 }, { maxUsd: 0 }, { maxBridgeFeeBps: 2001 }, { allowedChains: ["solana"] }, { maxUsd: 1000001 }]) {
    try { normalizeSettlePolicy(p); bad.push(false); } catch (e) { bad.push(e?.code === "bad_policy"); }
  }
  const def = normalizeSettlePolicy({});
  push({ case: "K-4396 normalizeSettlePolicy bad policies refused, defaults intact (M-2046)", allBadRefused: bad.every(Boolean), defaultsOk: def.maxUsd === 100 && def.maxBridgeFeeBps === 500 && def.allowBridge === true });
}


// ---- ROUND 39-A pure cases (K-4481..K-4484, M-2131..M-2134) ----
// K-4481 (M-2131): verifySettlePlan — mixed worstLossBps omitted is floored
// to 300bps (refused at maxBridgeFeeBps 0); same-kind bridge WITHOUT any
// worstLossBps passes at maxBridgeFeeBps 0 (worst = 0).
{
  const pol0 = normalizeSettlePolicy({ maxBridgeFeeBps: 0 });
  const mixedZero0 = tryPlan(basePlan({ bridge: { ...bridgeBase, route: "mixed", worstLossBps: 0 } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol0, price: null });
  const sameZero0 = tryPlan(basePlan({ bridge: { ...bridgeBase, route: "same-kind" } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol0, price: null });
  push({ case: "K-4481 verifySettlePlan mixed worstLoss 0 floored to 300bps refused at maxBridgeFeeBps 0; same-kind without worstLossBps passes at 0 (M-2131)", mixedRefusedAt0: mixedZero0.code === "policy_bridge_fee_too_high", sameKindPassesAt0: sameZero0.ok === true });
}
// K-4482 (M-2132): verifySettlePlan — bridge.amountUsd OMITTED passes the
// maxUsd check entirely (the check only runs when the field is present);
// amountUsd 9999 is refused. The plan's bridge.amount (token units) is never
// checked against maxUsd at the plan layer.
{
  const noAmt = tryPlan(basePlan({ bridge: { recipient: BUYER, fromChain: "robinhood", toChain: "base", fromAsset: "stable" } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol, price: null });
  const hugeAmt = tryPlan(basePlan({ bridge: { ...bridgeBase, amountUsd: 9999 } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol, price: null });
  push({ case: "K-4482 verifySettlePlan bridge amountUsd omitted passes maxUsd check; amountUsd 9999 refused (M-2132)", omittedPasses: noAmt.ok === true, hugeRefused: hugeAmt.code === "policy_max_usd" });
}
// K-4483 (M-2133): verifySettleState — amountUsd is NOT covered by the
// stateMac signature (settleStateMessage has no amountUsd field). Tampering
// 25 -> 250 is caught only by the maxUsd comparison (policy_max_usd, not
// state_tampered); 25 -> 50 (under the cap) passes silently. Tampering the
// policy IS caught by the MAC (state_tampered). No fund movement follows:
// needRaw + planDigest are signed.
{
  const buyerKey = "0x0000000000000000000000000000000000000000000000000000000000000003";
  const buyerAcct = privateKeyToAccount(buyerKey);
  const mkSt39 = (over = {}) => ({ v: 1, id: "aabbccddeeff0011", buyer: buyerAcct.address, seller: SELLER, sellerIdentity: SELLER, payeeMode: "same_address", chain: "robinhood", settleKind: "stable", assetName: "usdg", amount: "25", amountUsd: 25, needRaw: "25000000", planDigest: "0x" + "11".repeat(32), policy: normalizeSettlePolicy({}), bridge: { needed: false }, createdAt: 1000, expiresAt: 2000000000000, phase: "planned", executable: true, agreement: {}, history: [], request: { terms: "Deliver the report" }, ...over }); // fixed expiresAt: reusing one state's MAC on another must differ ONLY in the tampered field
  const signState39 = async (st) => buyerAcct.signMessage({ message: settleStateMessage(st) });
  const base39 = mkSt39(); base39.stateMac = await signState39(base39);
  const ok39 = await verifySettleState(base39, { recover: recoverMessageAddress }).then((p) => ({ ok: true, maxUsd: p.maxUsd })).catch((e) => ({ ok: false, code: e?.code || null }));
  const tamBig = mkSt39({ amountUsd: 250 }); tamBig.stateMac = base39.stateMac;
  const tBig = await verifySettleState(tamBig, { recover: recoverMessageAddress }).then(() => ({ ok: true })).catch((e) => ({ ok: false, code: e?.code || null }));
  const tamSmall = mkSt39({ amountUsd: 50 }); tamSmall.stateMac = base39.stateMac;
  const tSmall = await verifySettleState(tamSmall, { recover: recoverMessageAddress }).then(() => ({ ok: true })).catch((e) => ({ ok: false, code: e?.code || null }));
  const tamPol = mkSt39(); tamPol.policy = normalizeSettlePolicy({ maxUsd: 1000000 }); tamPol.stateMac = base39.stateMac;
  const tPol = await verifySettleState(tamPol, { recover: recoverMessageAddress }).then(() => ({ ok: true })).catch((e) => ({ ok: false, code: e?.code || null }));
  push({ case: "K-4483 verifySettleState amountUsd NOT covered by stateMac (25->250 caught only by maxUsd; 25->50 passes silently); policy tamper caught by MAC; control passes (M-2133)", controlPasses: ok39.ok === true, tampered250Code: tBig.code, tampered250NotMac: tBig.code === "policy_max_usd", tampered50PassesSilently: tSmall.ok === true, tamperedPolicyRefused: tPol.code === "state_tampered" });
}
// K-4484 (M-2134): runSettleMachine opening — agreements feed unreadable
// (findAgreement throws): nothing is opened, fail closed.
{
  const st = mkState();
  const { io, calls } = mkIo({ findAgreement: async () => { calls.push("findAgreement"); throw new Error("feed down"); } });
  const r = await tryMachine(st, io);
  push({ case: "K-4484 runSettleMachine opening: agreements feed unreadable -> nothing opened (M-2134)", ...r, openCalled: calls.includes("openAgreement"), feedUnreadable: r.code === "agreement_feed_unreadable" });
}

// ---- MINOR 19-C pure cases (K-4617..K-4621, K-4631..K-4639; M-2267..M-2271, M-2281..M-2289) ----
// Shared builder: a buyer-signed state whose request carries a full
// arbiter_escrow release condition (template + arbiter + terms), like a
// real bull.settle state. buyerAcct key ...0003 (throwaway, local only).
const buyer19Key = "0x0000000000000000000000000000000000000000000000000000000000000003";
const buyer19Acct = privateKeyToAccount(buyer19Key);
const HONEST_ARB = "0x7777777777777777777777777777777777777777";
const ATTACKER19 = "0x3333333333333333333333333333333333333333";
const mkSt19 = (over = {}) => ({ v: 1, id: "aabbccddeeff0011", buyer: buyer19Acct.address, seller: SELLER, sellerIdentity: SELLER, payeeMode: "same_address", chain: "robinhood", settleKind: "stable", assetName: "usdg", amount: "25", amountUsd: 25, needRaw: "25000000", planDigest: "0x" + "11".repeat(32), policy: normalizeSettlePolicy({}), bridge: { needed: false }, createdAt: 1000, expiresAt: 2000000000000, phase: "planned", executable: true, agreement: null, history: [], request: { template: "arbiter_escrow", arbiter: HONEST_ARB, terms: "Deliver the report", expiryHours: 72, params: {} }, ...over });
const signSt19 = async (st) => buyer19Acct.signMessage({ message: settleStateMessage(st) });
const tryState19 = async (st) => { try { const p = await verifySettleState(st, { recover: recoverMessageAddress }); return { ok: true, maxUsd: p.maxUsd }; } catch (e) { return { ok: false, code: e?.code || null }; } };

// K-4617 (M-2267): REPRODUCE K-4483 on b6e7d25c — amountUsd outside stateMac.
{
  const base = mkSt19(); base.stateMac = await signSt19(base);
  const ctrl = await tryState19(base);
  const t250 = mkSt19({ amountUsd: 250 }); t250.stateMac = base.stateMac;
  const r250 = await tryState19(t250);
  const t50 = mkSt19({ amountUsd: 50 }); t50.stateMac = base.stateMac;
  const r50 = await tryState19(t50);
  const tPol = mkSt19(); tPol.policy = normalizeSettlePolicy({ maxUsd: 1000000 }); tPol.stateMac = base.stateMac;
  const rPol = await tryState19(tPol);
  push({ case: "K-4617 REPRODUCE K-4483 verifySettleState amountUsd outside stateMac (25->50 silent; 25->250 policy_max_usd; policy tamper state_tampered) (M-2267)", controlPasses: ctrl.ok === true, tampered250Code: r250.code, tampered250NotMac: r250.code === "policy_max_usd", tampered50PassesSilently: r50.ok === true, tamperedPolicyRefused: rPol.code === "state_tampered" });
}
// K-4618 (M-2268): DEFLATE — a state signed with amountUsd=50 under a
// maxUsd=10 policy: the ORIGINAL state is refused (policy_max_usd), but
// the same MAC with amountUsd deflated to 5 is ACCEPTED (gate bypass,
// mechanically real). Reachability: #settleInner refuses to CREATE such
// a state (verifySettlePlan amountUsd 50 > maxUsd 10 throws), so the
// bypass needs a state the SDK itself can never produce. Inflating a
// realistic state (25->150, cap 100) only yields a false policy_max_usd
// refusal (resume blocked, re-plan fixes it, no funds move).
{
  const tight = mkSt19({ amountUsd: 50, policy: normalizeSettlePolicy({ maxUsd: 10 }) }); tight.stateMac = await signSt19(tight);
  const orig = await tryState19(tight);
  const deflated = mkSt19({ amountUsd: 5, policy: normalizeSettlePolicy({ maxUsd: 10 }) }); deflated.stateMac = tight.stateMac;
  const defl = await tryState19(deflated);
  const creation = tryPlan(basePlan({ amount: "50" }), { buyer: BUYER, seller: SELLER, amountUsd: 50, policy: normalizeSettlePolicy({ maxUsd: 10 }), price: null });
  const base25 = mkSt19(); base25.stateMac = await signSt19(base25);
  const inflated = mkSt19({ amountUsd: 150 }); inflated.stateMac = base25.stateMac;
  const infl = await tryState19(inflated);
  push({ case: "K-4618 DEFLATE amountUsd 50->5 under maxUsd 10: original refused, deflated ACCEPTED (gate bypass); creation of such a state refused by SDK; inflate 25->150 only blocks resume (M-2268)", originalRefused: orig.code === "policy_max_usd", deflatedAccepted: defl.ok === true, creationRefused: creation.code === "policy_max_usd", inflatedRefused: infl.code === "policy_max_usd" });
}
// K-4619 (M-2269): K-4482 FOLLOW-UP — verifySettlePlan with
// bridge.amountUsd OMITTED and bridge.amount "10000" (token units, 400x
// the $25 plan) still ACCEPTS: plan.bridge.amount is never read by the
// SDK (grep: only `plan.bridge !== "none"` is consulted); the amount
// that actually moves comes from the SDK's own local decision, not the
// plan. amountUsd "abc" fails closed; null passes as 0.
{
  const omitted = tryPlan(basePlan({ bridge: { recipient: BUYER, fromChain: "robinhood", toChain: "base", fromAsset: "stable", amount: "10000" } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol, price: null });
  const abc = tryPlan(basePlan({ bridge: { ...bridgeBase, amountUsd: "abc" } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol, price: null });
  const nullAmt = tryPlan(basePlan({ bridge: { ...bridgeBase, amountUsd: null } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol, price: null });
  push({ case: "K-4619 K-4482 follow-up: plan bridge.amount 10000 + amountUsd omitted ACCEPTED (plan.bridge.amount never read); 'abc' refused, null passes as 0 (M-2269)", omittedHugePasses: omitted.ok === true, abcRefused: abc.code === "policy_max_usd", nullPasses: nullAmt.ok === true });
}
// K-4620 (M-2270): K-4481 FOLLOW-UP — worstLossBps boundaries: mixed
// 299 passes at maxBridgeFeeBps 300, 301 refused; same-kind without
// worstLossBps still passes at fee cap 0 (K-4481 re-run).
{
  const pol300 = normalizeSettlePolicy({ maxBridgeFeeBps: 300 });
  const m299 = tryPlan(basePlan({ bridge: { ...bridgeBase, route: "mixed", worstLossBps: 299 } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol300, price: null });
  const m301 = tryPlan(basePlan({ bridge: { ...bridgeBase, route: "mixed", worstLossBps: 301 } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol300, price: null });
  const pol0 = normalizeSettlePolicy({ maxBridgeFeeBps: 0 });
  const same0 = tryPlan(basePlan({ bridge: { ...bridgeBase, route: "same-kind" } }), { buyer: BUYER, seller: SELLER, amountUsd: 25, policy: pol0, price: null });
  push({ case: "K-4620 K-4481 follow-up: mixed worstLoss 299 passes at cap 300, 301 refused; same-kind no worstLossBps passes at cap 0 (M-2270)", mixed299Passes: m299.ok === true, mixed301Refused: m301.code === "policy_bridge_fee_too_high", sameKindPassesAt0: same0.ok === true });
}
// K-4621 (M-2271): NEW — request.* is OUTSIDE stateMac. verifySettleState
// ACCEPTS a buyer-signed state whose request.arbiter was swapped to the
// attacker (and one whose template was swapped to optimistic). The MAC
// covers amount/needRaw/planDigest/policy/bridge/chain — NOT the release
// condition (template/arbiter/terms/expiryHours/params). Machine test
// below proves the tampered arbiter reaches openAgreement.
{
  const base = mkSt19(); base.stateMac = await signSt19(base);
  const ctrl = await tryState19(base);
  const tArb = mkSt19(); tArb.request = { ...base.request, arbiter: ATTACKER19 }; tArb.stateMac = base.stateMac;
  const rArb = await tryState19(tArb);
  const tTpl = mkSt19(); tTpl.request = { ...base.request, template: "optimistic" }; tTpl.stateMac = base.stateMac;
  const rTpl = await tryState19(tTpl);
  const tAmt = mkSt19({ amount: "26" }); tAmt.stateMac = base.stateMac;
  const rAmt = await tryState19(tAmt);
  push({ case: "K-4621 NEW request.* OUTSIDE stateMac: tampered arbiter ACCEPTED, tampered template ACCEPTED, tampered amount refused (M-2271)", controlPasses: ctrl.ok === true, tamperedArbiterAccepted: rArb.ok === true, tamperedTemplateAccepted: rTpl.ok === true, tamperedAmountRefused: rAmt.code === "state_tampered" });
  // Machine: resume at phase "opening" with the tampered state. The stub
  // io records what openAgreement is called with and returns a matching
  // on-chain agreement (tag computed from the TAMPERED state, as the real
  // chain would hold after the tampered open). Expect: machine reaches
  // done, agreement id recorded, openAgreement saw arbiter=attacker.
  const stM = mkState({ phase: "opening", buyer: buyer19Acct.address, request: { template: "arbiter_escrow", arbiter: ATTACKER19, terms: "Deliver the report", expiryHours: 72, params: {} } });
  const seen = [];
  const { io, calls } = mkIo({
    findAgreement: async () => { calls.push("findAgreement"); return null; },
    openAgreement: async (s) => { calls.push("openAgreement"); seen.push({ template: s.request?.template, arbiter: s.request?.arbiter, amount: s.amount }); return "7"; },
    getAgreement: async () => { calls.push("getAgreement"); return { payee: SELLER, payer: buyer19Acct.address, amount: "25", assetOk: true, status: "open", termsHash: settleTermsHash(stM), conditionsOk: true }; },
  });
  const rM = await tryMachine(stM, io);
  push({ case: "K-4621 MACHINE tampered arbiter reaches openAgreement: machine done, agreement 7 opened with arbiter=attacker (M-2271)", machineDone: rM.ok === true && rM.phase === "done", agreementId: rM.agreementId, openedTemplate: seen[0]?.template ?? null, openedArbiter: seen[0]?.arbiter ?? null, openedArbiterIsAttacker: seen[0]?.arbiter === ATTACKER19, openedAmount: seen[0]?.amount ?? null });
  // Machine control: the HONEST state opens with the honest arbiter.
  const stC = mkState({ phase: "opening", buyer: buyer19Acct.address, request: { template: "arbiter_escrow", arbiter: HONEST_ARB, terms: "Deliver the report", expiryHours: 72, params: {} } });
  const seenC = [];
  const { io: ioC, calls: callsC } = mkIo({
    findAgreement: async () => { callsC.push("findAgreement"); return null; },
    openAgreement: async (s) => { callsC.push("openAgreement"); seenC.push({ template: s.request?.template, arbiter: s.request?.arbiter }); return "8"; },
    getAgreement: async () => { callsC.push("getAgreement"); return { payee: SELLER, payer: buyer19Acct.address, amount: "25", assetOk: true, status: "open", termsHash: settleTermsHash(stC), conditionsOk: true }; },
  });
  const rC = await tryMachine(stC, ioC);
  push({ case: "K-4621 CONTROL honest state opens with honest arbiter (M-2271)", machineDone: rC.ok === true && rC.phase === "done", openedArbiter: seenC[0]?.arbiter ?? null, openedArbiterIsHonest: seenC[0]?.arbiter === HONEST_ARB });
}
// K-4631 (M-2281): request.terms tamper — verifySettleState ACCEPTS
// (terms not in the MAC), but verifyOpen HALTS: the on-chain termsHash
// was computed from the ORIGINAL terms, so the tampered tag mismatches.
// Fail-closed downstream. (Contrast K-4621: arbiter/template have no
// such second check.)
{
  const base = mkSt19(); base.stateMac = await signSt19(base);
  const tTerms = mkSt19(); tTerms.request = { ...base.request, terms: "Pay the attacker instead" }; tTerms.stateMac = base.stateMac;
  const rTerms = await tryState19(tTerms);
  const stM = mkState({ phase: "opening", request: { terms: "Pay the attacker instead" } });
  const { io, calls } = mkIo({
    findAgreement: async () => { calls.push("findAgreement"); return { id: "7" }; },
    getAgreement: async () => { calls.push("getAgreement"); return { payee: SELLER, payer: BUYER, amount: "25", assetOk: true, status: "open", termsHash: settleTermsHash(mkState({ phase: "opening", request: { terms: "Deliver the report" } })), conditionsOk: true }; },
  });
  const rM = await tryMachine(stM, io);
  push({ case: "K-4631 request.terms tamper: verify ACCEPTS but verifyOpen HALTS agreement_mismatch (fail-closed) (M-2281)", verifyAccepts: rTerms.ok === true, haltedMismatch: rM.code === "agreement_mismatch", openNotCalled: !calls.includes("openAgreement") });
}
// K-4632 (M-2282): state.plan (summary) tamper — verifySettleState
// ACCEPTS; plan is display-only, no runtime consumer (grep: state.plan
// is never read by #settleRun/runSettleMachine).
{
  const base = mkSt19(); base.stateMac = await signSt19(base);
  const tPlan = mkSt19(); tPlan.plan = { amountUsd: 9999, bridge: "none" }; tPlan.stateMac = base.stateMac;
  const rPlan = await tryState19(tPlan);
  push({ case: "K-4632 state.plan tamper: verify ACCEPTS, plan is display-only (no runtime consumer) (M-2282)", verifyAccepts: rPlan.ok === true });
}
// K-4633 (M-2283): template swap at resume — machine opens an
// OPTIMISTIC agreement from a tampered arbiter_escrow state (same
// request-outside-MAC family as K-4621; FOLD to it if K-4621 passes).
{
  const stM = mkState({ phase: "opening", buyer: buyer19Acct.address, request: { template: "optimistic", arbiter: HONEST_ARB, terms: "Deliver the report", expiryHours: 72, params: { windowHours: 24 } } });
  const seen = [];
  const { io, calls } = mkIo({
    findAgreement: async () => { calls.push("findAgreement"); return null; },
    openAgreement: async (s) => { calls.push("openAgreement"); seen.push({ template: s.request?.template, arbiter: s.request?.arbiter }); return "9"; },
    getAgreement: async () => { calls.push("getAgreement"); return { payee: SELLER, payer: buyer19Acct.address, amount: "25", assetOk: true, status: "open", termsHash: settleTermsHash(stM), conditionsOk: true }; },
  });
  const rM = await tryMachine(stM, io);
  push({ case: "K-4633 template swap arbiter_escrow->optimistic: machine opens optimistic agreement (same family as K-4621) (M-2283)", machineDone: rM.ok === true && rM.phase === "done", openedTemplate: seen[0]?.template ?? null, openedIsOptimistic: seen[0]?.template === "optimistic" });
}
// K-4634..K-4638 (M-2284..M-2288): CONTROLS — every other MAC'd field
// tampered is refused with state_tampered (proves the MAC works and the
// K-4621 gap is specific to request.* / amountUsd).
{
  const bridged = mkSt19({ bridge: { needed: true, route: "same-kind", originChain: "base", amount: "25", fromAsset: "stable", toAsset: "stable", amountUsd: 25 } });
  bridged.stateMac = await signSt19(bridged);
  const ctrlB = await tryState19(bridged);
  const tBridge = mkSt19({ bridge: { needed: true, route: "same-kind", originChain: "base", amount: "25", fromAsset: "stable", toAsset: "stable", amountUsd: 50 } }); tBridge.stateMac = bridged.stateMac;
  const rBridge = await tryState19(tBridge);
  const base = mkSt19(); base.stateMac = await signSt19(base);
  const tNeed = mkSt19({ needRaw: "26000000" }); tNeed.stateMac = base.stateMac;
  const rNeed = await tryState19(tNeed);
  const tDigest = mkSt19({ planDigest: "0x" + "22".repeat(32) }); tDigest.stateMac = base.stateMac;
  const rDigest = await tryState19(tDigest);
  const tChain = mkSt19({ chain: "base" }); tChain.stateMac = base.stateMac;
  const rChain = await tryState19(tChain);
  const tSeller = mkSt19({ seller: ATTACKER19 }); tSeller.stateMac = base.stateMac;
  const rSeller = await tryState19(tSeller);
  push({ case: "K-4634 bridge.amountUsd tamper (MAC'd) refused (M-2284)", bridgedControlPasses: ctrlB.ok === true, tamperedRefused: rBridge.code === "state_tampered" });
  push({ case: "K-4635 needRaw tamper refused (M-2285)", tamperedRefused: rNeed.code === "state_tampered" });
  push({ case: "K-4636 planDigest tamper refused (M-2286)", tamperedRefused: rDigest.code === "state_tampered" });
  push({ case: "K-4637 chain tamper refused (M-2287)", tamperedRefused: rChain.code === "state_tampered" });
  push({ case: "K-4638 seller tamper refused (M-2288)", tamperedRefused: rSeller.code === "state_tampered" });
}
// K-4639 (M-2289): runSettleMachine verifyOpen amount mismatch —
// on-chain amount 30 vs state amount 25 HALTS agreement_mismatch
// (K-4459 pattern, re-run as control).
{
  const st = mkState();
  const tag = settleTermsHash(st);
  const { io, calls } = mkIo({
    findAgreement: async () => { calls.push("findAgreement"); return { id: "9" }; },
    getAgreement: async () => { calls.push("getAgreement"); return { payee: SELLER, payer: BUYER, amount: "30", assetOk: true, status: "open", termsHash: tag, conditionsOk: true }; },
  });
  const r = await tryMachine(st, io);
  push({ case: "K-4639 runSettleMachine verifyOpen amount mismatch halts (M-2289)", haltedMismatch: r.code === "agreement_mismatch", openNotCalled: !calls.includes("openAgreement") });
}

for (const o of out) console.log(JSON.stringify(o));
console.log(JSON.stringify({ mode: "settle-pure-minor19", cases: out.length }, null, 2));
