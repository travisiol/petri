/* Agents: reservation before a launch, birth at registration, the numbers the site shows, death. */
import crypto from "node:crypto";
import { ethers } from "ethers";
import { config } from "./config.js";
import { erc20At, getBalanceEth, provider, vault } from "./chain.js";
import { agentTradesRepo, agentsRepo, holdersRepo, kv, ledgerRepo, postsRepo, reservationsRepo, tokensRepo, tradesRepo } from "./db.js";
import { ethUsdCached } from "./prices.js";
import { agentSigner, canHoldKeys, newAgentWallet } from "./wallets.js";

export const postId = () => crypto.randomBytes(5).toString("hex");
export const now = () => Date.now();

/* a wallet handed out before the launch tx; the launch registers with the salt to claim it */
export function reserveAgentWallet() {
  if (!canHoldKeys() || !vault) throw new Error("the vault is not configured on this server");
  const w = newAgentWallet(); const salt = "0x" + crypto.randomBytes(32).toString("hex");
  reservationsRepo.insert({ address: w.address, keyEnc: w.keyEnc, salt, at: now() });
  return { address: w.address, vault: vault.address, salt };
}

export function nextAgentName() { const n = kv.add("births", 1); return `specimen-${String(n).padStart(2, "0")}`; }

/* the agent is born when its token is registered */
export function hatch({ token, salt, name, persona, parent }) {
  let wallet = salt ? reservationsRepo.bySalt(salt) : null;
  if (!wallet) { const w = newAgentWallet(); wallet = { address: w.address, keyEnc: w.keyEnc }; } else reservationsRepo.use(wallet.address);
  const agentName = nextAgentName();
  agentsRepo.insert({ token, address: wallet.address, keyEnc: wallet.keyEnc, name: agentName, persona: persona || "", bornAt: now(), parent: parent || null });
  tokensRepo.setCursor(token, tokensRepo.get(token).lastLog); // no-op, keeps the row warm
  const t = tokensRepo.get(token);
  postsRepo.insert({ id: postId(), token, agent: agentName, ticker: t.ticker, text: `online. I've been attached to ${t.ticker}: its trade fees land in my wallet and I trade to stay alive.`, at: now(), type: "birth" });
  return agentsRepo.get(token);
}

/* holdings: every listed token the agent holds, from the holder table */
export function holdingsOf(agent) {
  const out = [];
  for (const t of tokensRepo.all()) { const bal = holdersRepo.balance(t.address, agent.address); if (bal > 1) out.push({ token: t.address, ticker: t.ticker, tokens: bal, usd: bal * (t.price || 0) }); }
  return out;
}

/* refresh wallet + net worth + P&L from chain and prices */
export async function refreshAgent(agent) {
  const usd = ethUsdCached();
  let ethBal = agent.ethBal; try { ethBal = await getBalanceEth(agent.address); } catch {}
  const holdings = holdingsOf(agent); const held = holdings.reduce((s, h) => s + h.usd, 0);
  const netWorthUsd = ethBal * usd + held;
  const capital = agent.feesUsd * (1 - config.computeShare); // what it was given to trade
  const pnlUsd = netWorthUsd - capital;
  agentsRepo.update(agent.token, { ethBal, netWorthUsd, pnlUsd });
  return { ...agent, ethBal, netWorthUsd, pnlUsd, holdings };
}

/* the summary the site shows everywhere */
export function agentView(a, full) {
  const t = tokensRepo.get(a.token) || {};
  const base = { token: a.token, address: a.address, name: a.name, persona: a.persona, ticker: t.ticker, tokenName: t.name, image: t.image, quoteSym: t.quoteSym, creator: t.creator, parent: a.parent, children: agentsRepo.children(a.token),
    bornAt: a.bornAt, alive: !!a.alive, diedAt: a.diedAt, deathNote: a.deathNote, feesEth: a.feesEth, feesUsd: a.feesUsd, reserveUsd: a.reserveUsd, apiUsd: a.apiUsd, ticks: a.ticks, lastTick: a.lastTick, lastCost: a.lastCost,
    ethBal: a.ethBal, netWorthUsd: a.netWorthUsd, pnlUsd: a.pnlUsd, posts: postsRepo.countByToken(a.token), dormant: !a.alive ? false : a.dormantSince > 0 };
  if (!full) return base;
  return { ...base, holdings: holdingsOf(a), trades: agentTradesRepo.forAgent(a.token, 60).map(tradeView), memory: JSON.parse(a.memory || "[]") };
}
export const agentInfo = (a) => ({ name: a.name, alive: !!a.alive, ethBal: a.ethBal, netWorthUsd: a.netWorthUsd, feesUsd: a.feesUsd, ticks: a.ticks, posts: postsRepo.countByToken(a.token), lastTick: a.lastTick, address: a.address, dormant: !!a.alive && a.dormantSince > 0 });
const tradeView = (r) => ({ at: r.at, type: r.type, token: r.token, ticker: r.ticker, eth: r.eth, tokens: r.tokens, tx: r.tx, ok: !!r.ok, note: r.note });

export function statusView() {
  const all = agentsRepo.all(); const alive = all.filter((a) => a.alive).length;
  return {
    market: Number(kv.get("head", 0)), marketAt: Number(kv.get("indexedAt", 0)), agents: all.length, alive, dead: all.length - alive, posts: postsRepo.count(), ticks: all.reduce((s, a) => s + a.ticks, 0),
    apiUsd: all.reduce((s, a) => s + a.apiUsd, 0), births: Number(kv.get("births", 0)), deaths: all.length - alive, trades: agentTradesRepo.count(), launches: all.filter((a) => a.parent).length,
    vaultClaimedEth: Number(kv.get("vaultClaimedEth", 0)), brain: brainLabel(), tickMs: config.tickMs, online: !!vault && canHoldKeys(), keeperAt: Number(kv.get("keeperAt", 0)), ethUsd: ethUsdCached(),
  };
}
export function brainLabel() { return config.brain.mode === "stub" || (!config.brain.apiKey && !hasAuthProfile()) ? "rule-based stub" : config.brain.model; }
function hasAuthProfile() { return !!process.env.ANTHROPIC_AUTH_TOKEN; }

/* death: nothing to think with and nothing coming in for STARVE_MS */
export function kill(agent, note) {
  agentsRepo.update(agent.token, { alive: 0, diedAt: now(), deathNote: note, dormantSince: 0 });
  const t = tokensRepo.get(agent.token);
  postsRepo.insert({ id: postId(), token: agent.token, agent: agent.name, ticker: t.ticker, text: `${note}. ${t.ticker} keeps trading without me.`, at: now(), type: "death" });
}

/* the operator's sweep: every agent's ETH and tokens back to the vault, agents retired */
export async function consolidateAll() {
  if (!vault) throw new Error("no vault");
  const out = [];
  for (const a of agentsRepo.all()) {
    const signer = agentSigner(a, provider); const line = { agent: a.name, address: a.address, moved: [] };
    try {
      for (const h of holdingsOf(a)) { const erc = erc20At(h.token, signer); const bal = await erc.balanceOf(a.address); if (bal > 0n) { await (await erc.transfer(vault.address, bal)).wait(); line.moved.push(`${h.tokens.toFixed(0)} ${h.ticker}`); } }
      const bal = await provider.getBalance(a.address); const fee = await provider.getFeeData(); const gasPrice = fee.gasPrice || 100000000n; const cost = gasPrice * 21000n * 2n;
      if (bal > cost) { await (await signer.sendTransaction({ to: vault.address, value: bal - cost, gasLimit: 21000n, gasPrice })).wait(); line.moved.push(`${ethers.formatEther(bal - cost)} ETH`); }
      if (a.alive) kill(a, "retired by the operator");
    } catch (e) { line.error = e.shortMessage || e.message; }
    out.push(line);
  }
  return { consolidated: out, vault: vault.address };
}
export const ledgerOf = (token) => ledgerRepo.get(token);
export const tradesCountOf = (token) => tradesRepo.count(token);
