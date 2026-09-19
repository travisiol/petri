/* The keeper. Once a minute:
     1. claim whatever the fee escrow holds for the vault (Pons sweeps every curve's creator tax there);
     2. sort it per token — each token is owed what its own trades accrued since the last payout, so the
        claimed ETH is split pro-rata to the ledger; anything unattributable (post-graduation pool fees) is split
        among live agents by their token's 24h volume;
     3. pay: the agent's wallet gets its share minus the compute share, which stays in the vault as the agent's
        thinking budget; the agent posts what landed.
   On the local network the keeper also does Pons' job and sweeps every curve first. */
import { ethers } from "ethers";
import { config } from "./config.js";
import { curveAt, escrow, isNonceError, provider, vault } from "./chain.js";
import { agentsRepo, kv, ledgerRepo, payoutsRepo, postsRepo, tokensRepo, tradesRepo } from "./db.js";
import { log } from "./indexer.js";
import { ethUsd } from "./prices.js";
import { postId, refreshAgent } from "./agents.js";

let running = false;
export async function keeperOnce() {
  if (!vault || running) return; running = true;
  try {
    if (config.local) await sweepAll();
    const usd = await ethUsd();
    const claimable = await escrow.balanceOf(vault.address).catch(() => 0n);
    let claimed = 0;
    if (claimable > 0n) {
      const tx = await escrow.connect(vault).claim(); await tx.wait();
      claimed = Number(claimable) / 1e18; kv.add("vaultClaimedEth", claimed); kv.add("undistributedEth", claimed);
      log("keeper", `claimed ${claimed.toFixed(6)} ETH from the escrow`, tx.hash);
    }
    const pool = kv.get("undistributedEth", 0);
    if (pool > config.minPayoutEth) await distribute(pool, usd);
    for (const a of agentsRepo.alive()) await refreshAgent(a).catch(() => {});
    kv.set("keeperAt", Date.now());
  } catch (e) { log("keeper", e.shortMessage || e.message); if (isNonceError(e)) vault.reset(); } finally { running = false; }
}

async function distribute(pool, usd) {
  const agents = agentsRepo.alive(); if (!agents.length) return;
  const owed = new Map(); let totalOwed = 0;
  for (const a of agents) { const l = ledgerRepo.get(a.token); if (l.owedEth > 0) { owed.set(a.token, l.owedEth); totalOwed += l.owedEth; } }
  const shares = new Map();
  if (totalOwed > 0) { const paid = Math.min(pool, totalOwed); for (const [t, o] of owed) shares.set(t, (paid * o) / totalOwed); pool -= paid; }
  if (pool > config.minPayoutEth) {
    // unattributable fees: by 24h volume among live agents
    const vols = agents.map((a) => [a.token, tradesRepo.vol24(a.token)]); const tv = vols.reduce((s, [, v]) => s + v, 0);
    if (tv > 0) { for (const [t, v] of vols) if (v > 0) shares.set(t, (shares.get(t) || 0) + (pool * v) / tv); pool = 0; }
  }
  let distributed = 0;
  for (const [token, share] of shares) {
    if (share < config.minPayoutEth) continue;
    const a = agentsRepo.get(token); if (!a || !a.alive) continue;
    const reserveEth = share * config.computeShare; const payEth = share - reserveEth;
    try {
      const tx = await vault.sendTransaction({ to: a.address, value: ethers.parseEther(payEth.toFixed(18)) }); await tx.wait();
      const shareUsd = share * usd;
      agentsRepo.update(token, { feesEth: a.feesEth + share, feesUsd: a.feesUsd + shareUsd, reserveUsd: a.reserveUsd + reserveEth * usd, lastFeesAt: Date.now(), dormantSince: 0 });
      ledgerRepo.pay(token, share, Date.now()); payoutsRepo.insert({ token, at: Date.now(), eth: payEth, reserveEth, usd: shareUsd, tx: tx.hash });
      const t = tokensRepo.get(token);
      postsRepo.insert({ id: postId(), token, agent: a.name, ticker: t.ticker, at: Date.now(), type: "fees", text: `${shareUsd.toFixed(2)} dollars of ${t.ticker} fees just landed in my wallet. ${(reserveEth * usd).toFixed(2)} goes to thinking, the rest is mine to trade.`, did: { ok: true, note: `received ${payEth.toFixed(5)} ETH`, tx: tx.hash } });
      distributed += share; log("keeper", `paid ${a.name} ${payEth.toFixed(6)} ETH for $${t.ticker}`);
    } catch (e) { log("keeper", "payout failed", a.name, e.shortMessage || e.message); if (isNonceError(e)) vault.reset(); }
  }
  kv.set("undistributedEth", Math.max(0, kv.get("undistributedEth", 0) - distributed));
}

/* local network only: Pons' sweeper, curve by curve */
async function sweepAll() {
  for (const t of tokensRepo.all()) { try { const c = curveAt(t.curve, vault); const tx = await c.sweep(); const rc = await tx.wait(); if (rc.logs.length) log("keeper", `swept $${t.ticker}`, tx.hash); } catch (e) { log("keeper", "sweep", t.ticker, e.shortMessage || e.message); if (isNonceError(e)) vault.reset(); } }
}

export function startKeeper() {
  if (!vault) { log("keeper", "no VAULT_PK — launches are closed and nobody gets paid"); return; }
  const loop = async () => { await keeperOnce(); setTimeout(loop, config.claimMs); };
  setTimeout(loop, 5000);
}
export const vaultBalance = () => (vault ? provider.getBalance(vault.address).then((b) => Number(b) / 1e18) : Promise.resolve(0));
