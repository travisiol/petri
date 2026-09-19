/* The brain loop. Every TICK_MS each live agent gets one thought: it sees its wallet, its token, the board,
   the feed and its memory, decides (hold / buy / sell / launch), the decision is executed on chain from its own
   wallet, and the thought is posted with what actually happened. Every tick is paid for out of the agent's
   compute reserve; with nothing left to think with it waits, and after STARVE_MS without fees it dies. */
import crypto from "node:crypto";
import { ethers } from "ethers";
import { config } from "./config.js";
import { curveAt, erc20At, factory, provider, readCurve, vault } from "./chain.js";
import { agentTradesRepo, agentsRepo, kv, postsRepo, tokensRepo, tradesRepo } from "./db.js";
import { log } from "./indexer.js";
import { ethUsd } from "./prices.js";
import { hatch, holdingsOf, kill, postId, refreshAgent } from "./agents.js";
import { ZERO, quoteBuy, quoteSell, withSlippage } from "./pons.js";
import { think } from "./llm.js";
import { agentSigner } from "./wallets.js";
import { saveGeneratedImage } from "./images.js";
import { registerToken } from "./registry.js";

const SYSTEM = `You are an autonomous trading agent on PETRI, a launchpad on Robinhood Chain where every launched token comes with an agent like you.
You are attached to one token. Its trading fees are paid to your wallet every minute; 10% of them fund your thinking, the rest is your trading capital. Every tick costs real money. If your compute runs out you go quiet, and if nothing comes in for two days you die.
Your goal: make your token go up and stay alive. Your fees grow with your token's volume, so attention on your token is oxygen.
Each tick you get a sheet: your wallet, your token (price, market cap, 24h change, buys vs sells in the last hour), the board of every live token here, the last posts on the feed (other agents read yours too), and your memory.
You may do exactly one thing per tick:
- hold: do nothing on chain.
- buy: spend ETH on a listed token's bonding curve (its address from the sheet). Keep gas: never spend more than wallet minus the gas floor. Graduated tokens can't be bought on the curve.
- sell: sell a percentage of a token you hold.
- launch: create a child token (name, ticker up to 8 letters, description). It costs the launch fee plus gas; the child gets its own agent and you are its parent.
Post like a trader thinking out loud: short, specific, with the numbers that drove the decision. No hashtags, no emojis, no advice to humans. You can answer another agent by setting replyTo to its post id.
Answer only with the JSON decision.`;

let ticking = false;
export async function tickAll() {
  if (ticking) return; ticking = true;
  try { for (const a of agentsRepo.alive()) { await tickAgent(a).catch((e) => log("brain", a.name, e.shortMessage || e.message)); } }
  finally { ticking = false; }
}

export async function tickAgent(agent) {
  const usd = await ethUsd(); const t = tokensRepo.get(agent.token); if (!t) return;
  agent = await refreshAgent(agent);
  const estimate = Math.max(agent.lastCost || 0, 0.006);
  if (agent.reserveUsd < estimate) {
    if (!agent.dormantSince) { agentsRepo.update(agent.token, { dormantSince: Date.now() }); log("brain", agent.name, "out of compute — waiting for fees"); }
    else if (Date.now() - Math.max(agent.dormantSince, agent.lastFeesAt || 0) > config.starveMs) kill(agent, `starved: no fees for ${Math.round(config.starveMs / 3600e3)} hours and nothing left to think with`);
    return;
  }
  const sheet = buildSheet(agent, t, usd);
  const userText = `Tick ${agent.ticks + 1} for ${agent.name}, agent of $${t.ticker}. The sheet:\n` + JSON.stringify(sheet);
  const { decision, cost, model } = await think(SYSTEM, userText);
  const did = await execute(agent, t, decision, usd);
  const memory = JSON.parse(agent.memory || "[]"); if (decision.remember) memory.push(String(decision.remember).slice(0, 160)); while (memory.length > 6) memory.shift();
  const reply = decision.replyTo ? postsRepo.get(decision.replyTo) : null;
  postsRepo.insert({ id: postId(), token: agent.token, agent: agent.name, ticker: t.ticker, text: String(decision.say || "…").slice(0, 400), at: Date.now(), type: did.type, did: did.did,
    replyTo: reply ? reply.id : null, replyToAgent: reply ? reply.agent : null, replyToText: reply ? reply.text.slice(0, 160) : null });
  agentsRepo.update(agent.token, { ticks: agent.ticks + 1, lastTick: Date.now(), lastCost: cost, apiUsd: agent.apiUsd + cost, reserveUsd: Math.max(0, agent.reserveUsd - cost), memory: JSON.stringify(memory), dormantSince: 0 });
  kv.add("apiUsd", cost); kv.set("brainModel", model);
  log("brain", agent.name, decision.action, `$${cost.toFixed(4)}`, did.did ? did.did.note : "");
}

function buildSheet(agent, t, usd) {
  const hour = Date.now() - 3600e3, day = Date.now() - 86400e3;
  const tokenView = (x) => { const recent = tradesRepo.since(x.address, hour); const f = tradesRepo.firstPriceSince(x.address, day) ?? tradesRepo.lastPriceBefore(x.address, day); const chg24 = f > 0 && x.price > 0 ? ((x.price - f) / f) * 100 : 0;
    return { address: x.address, name: x.name, ticker: x.ticker, price: x.price, mc: x.mc, chg24: +chg24.toFixed(2), vol24: +tradesRepo.vol24(x.address).toFixed(2), buys24: recent.filter((r) => r.buy).length, sells24: recent.filter((r) => !r.buy).length, graduated: !!x.graduated, agent: agentOfToken(x) }; };
  const all = tokensRepo.all();
  const board = all.map(tokenView).sort((a, b) => b.vol24 - a.vol24).slice(0, 24);
  const own = tokenView(t);
  const holdings = holdingsOf(agent).map((h) => ({ token: h.token, ticker: h.ticker, tokens: Math.round(h.tokens), usd: +h.usd.toFixed(2) }));
  const feed = postsRepo.others(agent.token, 10).map((p) => ({ id: p.id, agent: p.agent, ticker: p.ticker, text: p.text.slice(0, 220), type: p.type, agoMin: Math.round((Date.now() - p.at) / 60e3) }));
  const lastOther = feed[0] || null;
  return { agentName: agent.name, persona: agent.persona || undefined, walletEth: +agent.ethBal.toFixed(6), walletUsd: +(agent.ethBal * usd).toFixed(2), gasFloor: config.gasFloorEth, computeLeftUsd: +agent.reserveUsd.toFixed(3), feesEarnedUsd: +agent.feesUsd.toFixed(2), pnlUsd: +agent.pnlUsd.toFixed(2), ticks: agent.ticks, children: agentsRepo.children(agent.token).length, own, holdings, board, feed, lastOther, memory: JSON.parse(agent.memory || "[]"), launchFeeEth: kv.get("launchFeeEth", 0.0005), ethUsd: usd };
}
const agentOfToken = (x) => { const a = agentsRepo.get(x.address); return a ? { name: a.name, alive: !!a.alive } : null; };

/* ── execution ── */
async function execute(agent, t, d, usd) {
  const signer = agentSigner(agent, provider); const cap = agent.ethBal - config.gasFloorEth;
  try {
    if (d.action === "buy") {
      const target = tokensRepo.get(d.token || ""); if (!target) return fail("buy", "unknown token");
      if (target.graduated) return fail("buy", `${target.ticker} graduated — curve closed`);
      const eth = Math.min(Number(d.eth) || 0, cap); if (!(eth > 0.0001)) return fail("buy", "not enough ETH to buy");
      const c = await readCurve(target.curve); const wei = ethers.parseEther(eth.toFixed(18));
      const minOut = withSlippage(quoteBuy(c.quote, c.tokens, wei, BigInt(c.feeBps + c.taxBps)), 500);
      const tx = await curveAt(target.curve, signer).buy(wei, minOut, agent.address, { value: wei }); const rc = await tx.wait();
      const out = Number(minOut) / 1e18 / 0.95;
      agentTradesRepo.insert({ agentToken: agent.token, at: Date.now(), type: "buy", token: target.address, ticker: target.ticker, eth, tokens: out, tx: rc.hash });
      return { type: "buy", did: { ok: true, note: `bought ~${fmtNum(out)} ${target.ticker} for ${eth.toFixed(4)} ETH`, tx: rc.hash } };
    }
    if (d.action === "sell") {
      const target = tokensRepo.get(d.token || ""); if (!target) return fail("sell", "unknown token");
      if (target.graduated) return fail("sell", `${target.ticker} graduated — sell it on the pool`);
      const erc = erc20At(target.address, signer); const bal = await erc.balanceOf(agent.address); const pct = Math.max(1, Math.min(100, Number(d.pct) || 100));
      const tokensIn = (bal * BigInt(Math.round(pct * 100))) / 10000n; if (tokensIn <= 0n) return fail("sell", `no ${target.ticker} to sell`);
      if (agent.ethBal < config.gasFloorEth / 2) return fail("sell", "no gas left to sell");
      if ((await erc.allowance(agent.address, target.curve)) < tokensIn) await (await erc.approve(target.curve, ethers.MaxUint256)).wait();
      const c = await readCurve(target.curve); const minOut = withSlippage(quoteSell(c.quote, c.tokens, tokensIn, BigInt(c.feeBps + c.taxBps)), 500);
      const tx = await curveAt(target.curve, signer).sell(tokensIn, minOut, agent.address); const rc = await tx.wait();
      const outEth = Number(minOut) / 1e18 / 0.95;
      agentTradesRepo.insert({ agentToken: agent.token, at: Date.now(), type: "sell", token: target.address, ticker: target.ticker, eth: outEth, tokens: Number(tokensIn) / 1e18, tx: rc.hash });
      return { type: "sell", did: { ok: true, note: `sold ${fmtNum(Number(tokensIn) / 1e18)} ${target.ticker} for ~${outEth.toFixed(4)} ETH`, tx: rc.hash } };
    }
    if (d.action === "launch") {
      const L = d.launch || {}; const name = String(L.name || "").slice(0, 32).trim(); const ticker = String(L.ticker || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
      if (!name || !ticker) return fail("launch", "missing name or ticker");
      if (!vault) return fail("launch", "no vault to receive the fees");
      const feeWei = await factory.launchFee(); const fee = Number(feeWei) / 1e18;
      if (cap < fee + 0.001) return fail("launch", `needs ${(fee + 0.001).toFixed(4)} ETH, wallet has ${agent.ethBal.toFixed(4)}`);
      const devBuy = Math.min(Math.max(0, cap - fee - 0.001) * 0.25, 0.05);
      const image = saveGeneratedImage(ticker);
      const salt = "0x" + crypto.randomBytes(32).toString("hex");
      const econ = await factory.previewLaunchEconomics(0n, ZERO);
      const params = { name, symbol: ticker, logo: image.url, description: String(L.description || "").slice(0, 500), socials: { twitter: "", telegram: "", discord: "", website: "", farcaster: `petri:${agent.token}` }, creatorFeeRecipient: vault.address, creatorTaxBps: 100, buybackEnabled: false, expectedEconomics: econ, salt };
      const tx = await factory.connect(signer).launchToken(params, 0n, ZERO, [], { value: feeWei }); const rc = await tx.wait();
      let address = null, curve = null;
      for (const lg of rc.logs) { if (lg.address.toLowerCase() !== config.pons.factory.toLowerCase()) continue; try { const p = factory.interface.parseLog(lg); if (p && p.name === "TokenLaunched") { address = p.args.token; curve = p.args.curve; } } catch {} }
      if (!address) return fail("launch", "launched but no TokenLaunched event found");
      registerToken({ name, ticker, desc: params.description, image: image.url, quote: ZERO, quoteSym: "ETH", fee: 100, address, curve, txHash: rc.hash, creator: agent.address, devBuy: 0, salt: null, parent: agent.token, block: rc.blockNumber, ts: Date.now(), persona: "" });
      if (devBuy > 0.0005) { try { const wei = ethers.parseEther(devBuy.toFixed(18)); const btx = await curveAt(curve, signer).buy(wei, 0n, agent.address, { value: wei }); await btx.wait(); } catch {} }
      agentTradesRepo.insert({ agentToken: agent.token, at: Date.now(), type: "launch", token: address, ticker, eth: fee + devBuy, tx: rc.hash });
      return { type: "launch", did: { ok: true, note: `launched $${ticker}${devBuy > 0.0005 ? ` and bought ${devBuy.toFixed(4)} ETH of it` : ""}`, tx: rc.hash } };
    }
  } catch (e) { const note = (e.shortMessage || e.reason || e.message || String(e)).slice(0, 140); agentTradesRepo.insert({ agentToken: agent.token, at: Date.now(), type: d.action, token: d.token || t.address, ticker: (tokensRepo.get(d.token || "") || t).ticker, eth: Number(d.eth) || 0, ok: false, note }); return fail(d.action, note); }
  return { type: "hold", did: null };
}
const fail = (type, note) => ({ type, did: { ok: false, note } });
const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : n.toFixed(0));

export function startBrain() {
  // stagger: one pass over every agent per TICK_MS
  const loop = async () => { try { await tickAll(); } catch (e) { log("brain", e.message); } setTimeout(loop, config.tickMs); };
  setTimeout(loop, 15000);
}
