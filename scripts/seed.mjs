// Seeds the rehearsal the way users would: reserve an agent wallet, launch on the (mock) Pons factory with the
// vault as fee recipient, register the token, then trade from a few wallets with time passing between trades.
import { ethers } from "ethers";
import { FACTORY_ABI, CURVE_ABI, ERC20_ABI, ZERO } from "../server/pons.js";

const API = process.env.API || `http://127.0.0.1:${process.env.PORT || 3719}`;
const RPC = process.env.SEED_RPC || process.env.RPC_URL || "http://127.0.0.1:8719";
const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true, batchMaxCount: 1 });
const stack = await (await fetch(`${API}/api/stack`)).json();
const factory = new ethers.Contract(stack.factory, FACTORY_ABI, provider);
const signers = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((i) => provider.getSigner(i)));
const [creatorA, creatorB, creatorC, traderX, traderY, traderZ, team] = signers;
const j = async (path, body, headers) => { const r = await fetch(API + path, body ? { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) } : {}); const t = await r.json(); if (t.error) throw new Error(path + ": " + t.error); return t; };
const tick = async (sec) => { await provider.send("evm_increaseTime", [sec]); await provider.send("evm_mine", []); };
const svg = (ticker, h1, h2) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><radialGradient id="g" cx="45%" cy="38%" r="65%"><stop offset="0" stop-color="hsl(${h1},95%,74%)"/><stop offset=".6" stop-color="hsl(${h2},70%,42%)"/><stop offset="1" stop-color="#15110c"/></radialGradient></defs><rect width="256" height="256" fill="#0d0c0a"/><circle cx="128" cy="128" r="106" fill="url(#g)"/><circle cx="128" cy="128" r="106" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="4"/><text x="128" y="148" text-anchor="middle" font-family="Geist,Inter,Arial,sans-serif" font-weight="700" font-size="${ticker.length > 4 ? 46 : 60}" fill="#0d0c0a" letter-spacing="-2">${ticker}</text></svg>`;

async function launch(signer, { name, ticker, desc, hue, persona, devBuy = 0 }) {
  const rs = await j("/api/agent/reserve", {});
  const up = await fetch(`${API}/api/upload`, { method: "POST", headers: { "content-type": "image/svg+xml" }, body: svg(ticker, hue, hue + 25) }).then((r) => r.json());
  const econ = await factory.previewLaunchEconomics(0n, ZERO); const feeWei = await factory.launchFee();
  const params = { name, symbol: ticker, logo: up.url, description: desc, socials: { twitter: "", telegram: "", discord: "", website: "", farcaster: "" }, creatorFeeRecipient: rs.vault, creatorTaxBps: 100, buybackEnabled: false, expectedEconomics: econ, salt: rs.salt };
  const tx = await factory.connect(signer).launchToken(params, 0n, ZERO, [], { value: feeWei }); const rc = await tx.wait();
  let address, curve; for (const lg of rc.logs) { try { const p = factory.interface.parseLog(lg); if (p && p.name === "TokenLaunched") { address = p.args.token; curve = p.args.curve; } } catch {} }
  const me = await signer.getAddress();
  if (devBuy > 0) { const wei = ethers.parseEther(String(devBuy)); await (await new ethers.Contract(curve, CURVE_ABI, signer).buy(wei, 0n, me, { value: wei })).wait(); }
  const reg = await j("/api/tokens", { name, ticker, desc, image: up.url, quote: ZERO, quoteSym: "ETH", fee: 100, address, curve, txHash: rc.hash, creator: me, devBuy, salt: rs.salt, persona });
  console.log(`launched $${ticker} ${address} curve ${curve} agent ${reg.agent.name} ${reg.agent.address}`);
  return { address, curve, ticker };
}
const buy = async (signer, t, eth) => { const wei = ethers.parseEther(String(eth)); await (await new ethers.Contract(t.curve, CURVE_ABI, signer).buy(wei, 0n, await signer.getAddress(), { value: wei })).wait(); };
const sell = async (signer, t, frac) => { const me = await signer.getAddress(); const erc = new ethers.Contract(t.address, ERC20_ABI, signer); const bal = await erc.balanceOf(me); const amt = (bal * BigInt(Math.round(frac * 1000))) / 1000n; if (amt <= 0n) return; await (await erc.approve(t.curve, amt)).wait(); await (await new ethers.Contract(t.curve, CURVE_ABI, signer).sell(amt, 0n, me)).wait(); };

// 1. the platform's own token, launched by the team wallet — it will graduate
const PETRI = await launch(team, { name: "Petri", ticker: "PETRI", desc: "The dish itself. Fees from every launch flow through the vault; this one feeds the first specimen.", hue: 32, devBuy: 0.05 });
const MOLD = await launch(creatorA, { name: "Slime Mold", ticker: "MOLD", desc: "Finds the shortest path to liquidity. A single-celled trader with no brain until now.", hue: 95, persona: "Cautious. Speaks in short sentences. Hates chasing green candles.", devBuy: 0.02 });
const SPORE = await launch(creatorB, { name: "Spore Drive", ticker: "SPORE", desc: "Every dish needs a way out.", hue: 265 });

// 2. an hour of trading, two minutes a block
const plan = [
  [traderX, PETRI, "buy", 0.3], [traderY, PETRI, "buy", 0.25], [traderZ, MOLD, "buy", 0.06], [traderX, PETRI, "buy", 0.4], [creatorC, PETRI, "buy", 0.6], [traderY, MOLD, "buy", 0.03], [traderZ, PETRI, "sell", 0.0],
  [traderX, MOLD, "sell", 0.5], [traderY, PETRI, "buy", 0.5], [traderZ, PETRI, "buy", 0.35], [creatorC, MOLD, "buy", 0.02], [traderX, PETRI, "buy", 0.7], [traderY, SPORE, "buy", 0.01], [traderZ, MOLD, "sell", 0.3],
  [creatorC, PETRI, "buy", 0.55], [traderX, SPORE, "buy", 0.004], [traderY, PETRI, "buy", 0.6], [traderZ, PETRI, "buy", 0.45], [traderX, MOLD, "buy", 0.04], [traderY, MOLD, "sell", 0.4], [creatorC, PETRI, "buy", 0.5],
];
for (const [s, t, side, x] of plan) { await tick(120 + Math.floor(Math.random() * 60)); try { if (side === "buy") await buy(s, t, x); else await sell(s, t, x || 0.5); } catch (e) { console.log("trade skipped:", t.ticker, side, (e.shortMessage || e.message).slice(0, 80)); } }
await tick(30);
// 3. one more, launched just now, still on zero trades
await launch(creatorC, { name: "Agar Agar", ticker: "AGAR", desc: "Fresh dish. Nothing has grown here yet.", hue: 200 });
console.log("seeded — the indexer, keeper and brain take it from here");
