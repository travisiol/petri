/* The JSON the site reads. Public and read-only, except the three launch endpoints, the upvote and the admin sweep. */
import express from "express";
import { ethers } from "ethers";
import { config } from "./config.js";
import { blockTime, factory, provider, vault } from "./chain.js";
import { agentsRepo, holdersRepo, kv, ledgerRepo, payoutsRepo, postsRepo, tokensRepo, tradesRepo } from "./db.js";
import { agentInfo, agentView, consolidateAll, reserveAgentWallet, statusView } from "./agents.js";
import { imagesDir, saveUpload, setPublicBase } from "./images.js";
import { registerToken, verifyLaunch } from "./registry.js";
import { ethUsd, ethUsdCached } from "./prices.js";
import { vaultBalance } from "./keeper.js";
import { useRealBrain } from "./llm.js";

export const api = express.Router();
api.use((req, _res, next) => { setPublicBase(process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`); next(); });

const DAY = 86400e3;
function tokenView(t) {
  const a = agentsRepo.get(t.address);
  const f = tradesRepo.firstPriceSince(t.address, Date.now() - DAY) ?? tradesRepo.lastPriceBefore(t.address, Date.now() - DAY);
  const chg = f > 0 && t.price > 0 ? ((t.price - f) / f) * 100 : 0;
  return { name: t.name, ticker: t.ticker, desc: t.desc, image: t.image, twitter: t.twitter, website: t.website, quote: t.quote, quoteSym: t.quoteSym, fee: t.fee, address: t.address, curve: t.curve, txHash: t.txHash, creator: t.creator, devBuy: t.devBuy,
    explorer: config.explorer, ts: t.ts, mc: t.mc, price: t.price, pricedAt: t.pricedAt, chg, vol24: tradesRepo.vol24(t.address), spark: spark(t), graduated: !!t.graduated, platform: "pons", agent: a ? a.address : null, parent: t.parent, featured: !!t.featured, agentInfo: a ? agentInfo(a) : null, trades: tradesRepo.count(t.address), holders: holdersRepo.count(t.address) };
}
function spark(t) {
  const pts = tradesRepo.hist(t.address, 200).reverse(); if (!pts.length) return [];
  const t0 = Math.max(pts[0].t, Date.now() - DAY); const t1 = Date.now(); const N = 16; const out = []; let last = tradesRepo.lastPriceBefore(t.address, t0) ?? pts[0].p;
  for (let i = 0; i < N; i++) { const end = t0 + ((i + 1) / N) * (t1 - t0); for (const p of pts) if (p.t <= end && p.t > t0 + (i / N) * (t1 - t0)) last = p.p; out.push(+last.toPrecision(6)); }
  if (t.price > 0) out[N - 1] = t.price;
  return out;
}

api.get("/tokens", (_req, res) => res.json(tokensRepo.all().map(tokenView)));
api.get("/agents", (_req, res) => res.json({ agents: agentsRepo.all().map((a) => agentView(a, true)), status: statusView() }));
api.get("/agent", (req, res) => { const a = agentsRepo.get(String(req.query.token || "")); if (!a) return res.status(404).json({ error: "no agent" }); res.json({ agent: agentView(a, true), posts: postsRepo.latest(80, a.token).map(postView) }); });
api.get("/feed", (req, res) => { const n = Math.min(300, Math.max(1, Number(req.query.n) || 60)); res.json({ posts: postsRepo.latest(n, req.query.token ? String(req.query.token) : null).map(postView), status: statusView() }); });
api.post("/feed/up", express.json(), (req, res) => { const id = String((req.body && req.body.id) || ""); if (!postsRepo.get(id)) return res.status(404).json({ error: "no post" }); postsRepo.upvote(id); res.json({ ok: true }); });
function postView(p) { const t = tokensRepo.get(p.token) || {}; return { id: p.id, token: p.token, agent: p.agent, ticker: p.ticker, image: t.image || "", text: p.text, at: p.at, votes: p.votes, type: p.type, did: p.did, replyTo: p.replyTo || undefined, replyToAgent: p.replyToAgent || undefined, replyToText: p.replyToText || undefined }; }

api.get("/trades", (req, res) => {
  const t = tokensRepo.get(String(req.query.token || "")); if (!t) return res.status(404).json({ error: "unknown token" });
  const a = agentsRepo.get(t.address); const l = ledgerRepo.get(t.address); const usd = ethUsdCached();
  const trades = tradesRepo.forToken(t.address, 300).map((r) => ({ ts: r.ts, buy: !!r.buy, usd: r.usd, tokens: r.tokens, price: r.price, tax: r.tax, tx: r.tx, li: r.li, who: r.who }));
  const hist = tradesRepo.hist(t.address, 600);
  res.json({ trades, hist, price: t.price, mc: t.mc, graduated: !!t.graduated, pricedAt: t.pricedAt, fees: { accruedUsd: (l.owedEth + l.paidEth) * usd, paidUsd: a ? a.feesUsd : l.paidEth * usd, pendingUsd: l.owedEth * usd, reserveUsd: a ? a.reserveUsd : 0, payouts: payoutsRepo.forToken(t.address).length } });
});
api.get("/holders", (req, res) => {
  const t = tokensRepo.get(String(req.query.token || "")); if (!t) return res.status(404).json({ error: "unknown token" });
  const rows = holdersRepo.top(t.address, 60); const supply = 1e9; const a = agentsRepo.get(t.address);
  const label = (addr) => addr === t.curve ? "Bonding curve" : a && addr === a.address ? a.name : addr === t.creator ? "creator" : (agentsRepo.byAddress(addr) || {}).name || "";
  res.json({ count: holdersRepo.count(t.address), holders: rows.map((r) => ({ addr: r.addr, balance: r.balance, since: r.since, share: (r.balance / supply) * 100, label: label(r.addr) })) });
});
api.get("/search", (req, res) => { const q = String(req.query.q || "").trim(); res.json({ hits: q ? tokensRepo.search(q).map((t) => ({ ticker: t.ticker, name: t.name, image: t.image, address: t.address, mc: t.mc, quote: t.quote })) : [] }); });
api.get("/stack", async (_req, res) => {
  const launchFeeEth = kv.get("launchFeeEth", 0.0005);
  res.json({ factory: config.pons.factory, forwarder: config.pons.forwarder, escrow: config.pons.escrow, vault: vault ? vault.address : null, chainId: config.chainId, chainHex: "0x" + config.chainId.toString(16), chainName: config.chainName, rpc: config.local ? config.rpcUrl : "https://rpc.mainnet.chain.robinhood.com", explorer: config.explorer,
    registryEra: "1", launchFeeEth, tickMs: config.tickMs, claimMs: config.claimMs, computeShare: config.computeShare, local: config.local, closed: !vault, shutdown: false, tradeUrl: "https://www.ponsfamily.com/launchpad/", brain: useRealBrain() ? config.brain.model : "rule-based stub", social: config.socialX });
});
api.get("/pairs", (_req, res) => res.json({ pairs: [{ sym: "ETH", name: "Ether", icon: "ETH.svg", address: ethers.ZeroAddress, decimals: 18, cls: "native", usd: ethUsdCached() }] }));
api.get("/quotes", async (_req, res) => { const u = await ethUsd(); res.json({ ethUsd: u, nativeUsd: u, native: "ETH", pairs: { ETH: u } }); });
api.get("/stats", (_req, res) => {
  const all = tokensRepo.all(); const day = Date.now() - DAY;
  res.json({ updatedAt: Date.now(), vol24Usd: all.reduce((s, t) => s + tradesRepo.vol24(t.address), 0), launches24: all.filter((t) => t.ts > day).length, launchesAll: all.length, graduated: all.filter((t) => t.graduated).length, agents: statusView() });
});
api.get("/status", async (_req, res) => {
  const st = statusView(); const head = kv.get("head", 0); const idxAgo = Date.now() - (kv.get("indexedAt", 0) || 0); const keeperAgo = Date.now() - (st.keeperAt || 0);
  let rpcOk = true; try { await provider.getBlockNumber(); } catch { rpcOk = false; }
  const vb = await vaultBalance().catch(() => 0);
  res.json({ checkedAt: Date.now(), services: [
    { name: "Website", ok: true, label: "Operational" }, { name: "Data storage", ok: true, label: `Operational · ${tokensRepo.count()} tokens · ${postsRepo.count()} posts` },
    { name: `${config.chainName} RPC`, ok: rpcOk, label: rpcOk ? `Operational · block ${head}` : "Unreachable" },
    { name: "Chain indexer", ok: idxAgo < config.indexMs * 4, label: idxAgo < config.indexMs * 4 ? `Last pass ${Math.round(idxAgo / 1000)}s ago` : "Stalled" },
    { name: "Vault (fees → agents)", ok: !!vault && keeperAgo < config.claimMs * 3, label: vault ? `${keeperAgo < config.claimMs * 3 ? "Operational" : "Stalled"} · ${vault.address.slice(0, 6)}…${vault.address.slice(-4)} · ${vb.toFixed(4)} ETH · ${st.vaultClaimedEth.toFixed(4)} ETH claimed` : "Not configured — launches closed" },
    { name: "Brain", ok: true, label: `${st.brain} · ${st.alive} alive · $${st.apiUsd.toFixed(2)} spent thinking` },
    { name: "Price feed", ok: ethUsdCached() > 0, label: ethUsdCached() > 0 ? `ETH $${ethUsdCached().toFixed(2)}` : "No price yet" },
  ] });
});

/* ── launching ── */
api.post("/agent/reserve", (_req, res) => { try { res.json(reserveAgentWallet()); } catch (e) { res.status(503).json({ error: e.message }); } });
api.post("/upload", express.raw({ type: ["image/*"], limit: "6mb" }), (req, res) => { try { res.json(saveUpload(req.body, req.get("content-type").split(";")[0])); } catch (e) { res.status(400).json({ error: e.message }); } });
api.post("/tokens", express.json({ limit: "64kb" }), async (req, res) => {
  const b = req.body || {};
  try {
    const name = String(b.name || "").slice(0, 32).trim(); const ticker = String(b.ticker || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    if (!name || !ticker) throw new Error("name and ticker are required");
    if (!ethers.isAddress(b.creator)) throw new Error("bad creator");
    await verifyLaunch(String(b.address), String(b.curve));
    const rc = b.txHash ? await provider.getTransactionReceipt(String(b.txHash)).catch(() => null) : null; const ts = rc ? await blockTime(rc.blockNumber).catch(() => Date.now()) : Date.now();
    const { token, agent } = registerToken({ name, ticker, desc: String(b.desc || "").slice(0, 500), image: String(b.image || "").slice(0, 300), twitter: String(b.twitter || "").slice(0, 120), website: String(b.website || "").slice(0, 160), quote: ethers.ZeroAddress, quoteSym: "ETH", fee: Number(b.fee) || 100, address: String(b.address), curve: String(b.curve), txHash: String(b.txHash || ""), creator: String(b.creator).toLowerCase(), devBuy: Number(b.devBuy) || 0, salt: b.salt ? String(b.salt) : null, block: rc ? rc.blockNumber : 0, ts, persona: String(b.persona || "").slice(0, 300) });
    res.json({ ok: true, token: tokenView(token), agent: agentView(agent) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
api.post("/agents/consolidate", async (req, res) => {
  if (!config.adminKey || req.get("x-admin-key") !== config.adminKey) return res.status(403).json({ error: "bad admin key" });
  try { res.json(await consolidateAll()); } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── read-only JSON-RPC relay for the browser (quotes, balances) ── */
const RPC_OK = new Set(["eth_chainId", "eth_blockNumber", "eth_call", "eth_getBalance", "eth_estimateGas", "eth_gasPrice", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getCode", "eth_getLogs", "eth_feeHistory", "eth_maxPriorityFeePerGas", "net_version", "eth_getTransactionCount", "eth_sendRawTransaction", "eth_getBlockByNumber"]);
api.post("/rpc", express.json({ limit: "256kb" }), async (req, res) => {
  const body = req.body; const list = Array.isArray(body) ? body : [body];
  if (list.some((m) => !m || !RPC_OK.has(m.method))) return res.status(400).json({ error: "method not allowed" });
  try { const r = await fetch(config.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }); res.status(r.status).type("json").send(await r.text()); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

export const images = express.static(imagesDir, { maxAge: "30d", immutable: true });
export async function warmStack() { try { kv.set("launchFeeEth", Number(await factory.launchFee()) / 1e18); } catch {} }
