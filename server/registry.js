/* Listing a launched token. The chain is the source of truth: the token's curve must exist, be a Pons curve
   and pay its creator fees to the vault — otherwise the agent would never eat. */
import { ethers } from "ethers";
import { config } from "./config.js";
import { curveAt, provider, vault } from "./chain.js";
import { agentsRepo, tokensRepo } from "./db.js";
import { hatch } from "./agents.js";
import { indexOnce } from "./indexer.js";

export async function verifyLaunch(address, curve) {
  if (!ethers.isAddress(address) || !ethers.isAddress(curve)) throw new Error("bad address");
  if (tokensRepo.get(address)) throw new Error("already listed");
  const code = await provider.getCode(curve); if (!code || code === "0x") throw new Error("no curve at that address");
  const c = curveAt(curve);
  const [dep, res] = await Promise.all([c.deployer(), c.getReserves()]);
  if (!vault || String(dep).toLowerCase() !== vault.address.toLowerCase()) throw new Error("the curve's fee recipient is not the PETRI vault — launch through the site so the agent gets paid");
  if (res[1] === 0n) throw new Error("empty curve");
  return true;
}

export function registerToken(t) {
  const address = t.address.toLowerCase(); const curve = t.curve.toLowerCase();
  tokensRepo.insert({ address, curve, name: t.name, ticker: t.ticker, desc: t.desc || "", image: t.image || "", twitter: t.twitter || "", website: t.website || "", quote: (t.quote || ethers.ZeroAddress).toLowerCase(), quoteSym: t.quoteSym || "ETH", fee: Number(t.fee) || 100, txHash: t.txHash || "", creator: t.creator, devBuy: Number(t.devBuy) || 0, ts: t.ts || Date.now(), block: Math.max(0, (t.block || 0) - 1), salt: t.salt || "", era: t.era || "", parent: t.parent || null });
  const agent = hatch({ token: address, salt: t.salt, persona: t.persona || "", parent: t.parent || null });
  tokensRepo.setCursor(address, Math.max(0, (t.block || 0) - 1));
  setTimeout(() => indexOnce().catch(() => {}), 500);
  return { token: tokensRepo.get(address), agent };
}
export const isListed = (a) => !!tokensRepo.get(a);
export const agentCount = () => agentsRepo.count();
