/* The chain indexer. Every INDEX_MS it walks each listed token's curve for CurveBuy / CurveSell since the last
   block it saw, turns them into trades (price, USD, the creator tax that feeds the agent), keeps the holder
   table from the token's Transfer logs, then re-reads the curve for spot price, market cap and graduation. */
import { ethers } from "ethers";
import { config } from "./config.js";
import { blockTime, provider, readCurve } from "./chain.js";
import { holdersRepo, ledgerRepo, tokensRepo, tradesRepo, kv } from "./db.js";
import { TOPICS, iface } from "./pons.js";
import { ethUsd } from "./prices.js";

const CHUNK = 5000; // blocks per getLogs on the public RPC
let current = null;
const listeners = new Set();
export const onTrade = (fn) => listeners.add(fn);

/* one pass over every token; a call made while a pass runs waits for it, then runs its own */
export async function indexOnce() {
  if (current) { try { await current; } catch {} }
  current = pass();
  try { await current; } finally { current = null; }
}
async function pass() {
  const head = await provider.getBlockNumber(); const usd = await ethUsd();
  for (const t of tokensRepo.all()) {
    try { await indexToken(t, head, usd); } catch (e) { log("index", t.ticker, e.shortMessage || e.message); }
  }
  kv.set("indexedAt", Date.now()); kv.set("head", head);
}

async function indexToken(t, head, usd) {
  let from = Math.max(t.lastLog + 1, t.block || 0);
  while (from <= head) {
    const to = Math.min(head, from + CHUNK - 1);
    const logs = await provider.getLogs({ address: t.curve, fromBlock: from, toBlock: to, topics: [[TOPICS.buy, TOPICS.sell]] });
    for (const lg of logs) await applyTrade(t, lg, usd);
    const xfers = await provider.getLogs({ address: t.address, fromBlock: from, toBlock: to, topics: [TOPICS.transfer] });
    for (const lg of xfers) { const p = iface.erc20.parseLog(lg); const v = Number(p.args.value) / 1e18; const ts = await blockTime(lg.blockNumber); if (p.args.from !== ethers.ZeroAddress) holdersRepo.apply(t.address, p.args.from, -v, ts); holdersRepo.apply(t.address, p.args.to, v, ts); }
    tokensRepo.setCursor(t.address, to); from = to + 1;
  }
  const c = await readCurve(t.curve);
  const price = c.spotEth * usd; const mc = c.mcEth * usd;
  tokensRepo.setPrice(t.address, price, mc, c.graduated);
}

async function applyTrade(t, lg, usd) {
  const p = iface.curve.parseLog(lg); if (!p) return;
  const buy = p.name === "CurveBuy"; const ts = await blockTime(lg.blockNumber);
  const quoteWei = buy ? p.args.quoteIn : p.args.quoteOut; const tokensWei = buy ? p.args.tokensOut : p.args.tokensIn;
  const quoteEth = Number(quoteWei) / 1e18; const tokens = Number(tokensWei) / 1e18; const taxEth = Number(p.args.creatorTax) / 1e18;
  const feeEth = Number(p.args.fee) / 1e18;
  // price per token in USD from what actually crossed: net quote / tokens
  const net = buy ? quoteEth - feeEth - taxEth : quoteEth; const price = tokens > 0 ? (net / tokens) * usd : 0;
  const row = { token: t.address, ts, block: lg.blockNumber, li: lg.index, buy, quoteEth, usd: quoteEth * usd, tokens, price, taxEth, tax: taxEth * usd, tx: lg.transactionHash, who: buy ? p.args.recipient : p.args.sender };
  const before = tradesRepo.count(t.address);
  tradesRepo.insert(row);
  if (tradesRepo.count(t.address) > before) { if (taxEth > 0) ledgerRepo.add(t.address, taxEth); for (const fn of listeners) { try { fn(t, row); } catch {} } }
}

export function startIndexer() {
  const loop = async () => { try { await indexOnce(); } catch (e) { log("indexer", e.shortMessage || e.message); } setTimeout(loop, config.indexMs); };
  loop();
}
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
