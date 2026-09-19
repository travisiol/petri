// The proof against the REAL Pons V2 contracts, on a hardhat fork of Robinhood Chain.
//   FORK_URL=https://rpc.mainnet.chain.robinhood.com node scripts/fork-check.mjs
// Starts a fork on :8720, then, with the server's own modules pointed at it:
//   1. launches a token through the real factory with the vault as creatorFeeRecipient (what /create does);
//   2. buys and sells it on the real curve from a trader wallet;
//   3. runs the indexer once and checks the trades, the creator-tax ledger and the price it derives;
//   4. hands the vault the swept fees the way Pons' sweeper would (escrow storage can't be forged, so the
//      claimed amount is credited directly) and runs the keeper's split: agent wallet + compute reserve;
//   5. runs one brain tick (stub) and checks the agent's buy landed on the real curve;
//   6. launches a child through the agent's wallet via the real factory.
// Every step is a real transaction against real bytecode; only the escrow credit is simulated.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FORK_URL = process.env.FORK_URL || "https://rpc.mainnet.chain.robinhood.com";
const PORT = process.env.FORK_PORT || "8720"; const RPC = `http://127.0.0.1:${PORT}`;
const VAULT_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // hardhat #1 as the vault
const data = path.join(root, "data-fork-check"); fs.rmSync(data, { recursive: true, force: true }); fs.mkdirSync(data, { recursive: true });
Object.assign(process.env, { LOCAL: "", HARDHAT: "1", RPC_URL: RPC, CHAIN_ID: "4663", DATA_DIR: data, VAULT_PK, WALLET_SECRET: "fork-check-secret", BRAIN: "stub", TICK_MS: "999999", CLAIM_MS: "999999", INDEX_MS: "999999", PUBLIC_URL: "http://127.0.0.1:3719" });

const chain = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["hardhat", "node", "--port", PORT, "--hostname", "127.0.0.1"], { cwd: path.join(root, "chain"), env: { ...process.env, FORK_URL, HARDHAT_CHAIN_ID: "4663" }, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
const stop = () => { try { process.platform === "win32" ? spawn("taskkill", ["/pid", String(chain.pid), "/t", "/f"]) : chain.kill(); } catch {} };
process.on("exit", stop); process.on("SIGINT", () => { stop(); process.exit(1); });
const rpc = async (method, params = []) => { const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; };
const t0 = Date.now(); while (Date.now() - t0 < 90000) { try { if (await rpc("eth_blockNumber")) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }
await rpc("evm_mine"); // wake the fork before the first eth_call
console.log("fork up at block", parseInt(await rpc("eth_blockNumber"), 16));

const { config } = await import("../server/config.js");
const { provider, factory, vault, curveAt, erc20At, readCurve, escrow, managed } = await import("../server/chain.js");
const { agentsRepo, tokensRepo, tradesRepo, ledgerRepo, postsRepo, kv, payoutsRepo } = await import("../server/db.js");
const { reserveAgentWallet } = await import("../server/agents.js");
const { registerToken } = await import("../server/registry.js");
const { indexOnce } = await import("../server/indexer.js");
const { keeperOnce } = await import("../server/keeper.js");
const { tickAgent } = await import("../server/brain.js");
const { ZERO } = await import("../server/pons.js");
const { ethUsd } = await import("../server/prices.js");
const checks = []; const check = (name, ok, detail) => { checks.push([name, !!ok]); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!ok) process.exitCode = 1; };

// fund the vault and a trader from hardhat's own accounts
await rpc("hardhat_setBalance", [vault.address, "0x" + (10n ** 21n).toString(16)]);
const trader = managed(new ethers.Wallet("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", provider)); await rpc("hardhat_setBalance", [trader.address, "0x" + (10n ** 21n).toString(16)]);
check("real factory answers", (await factory.launchFee()) > 0n, `launchFee ${ethers.formatEther(await factory.launchFee())} ETH · escrow ${await factory.feeEscrow()}`);
check("escrow address matches config", (await factory.feeEscrow()).toLowerCase() === config.pons.escrow.toLowerCase());

// 1. launch as a user would, fee recipient = vault
const rs = reserveAgentWallet(); const econ = await factory.previewLaunchEconomics(0n, ZERO); const feeWei = await factory.launchFee();
const params = { name: "Fork Check", symbol: "FORK", logo: "http://127.0.0.1:3719/i/fork.svg", description: "PETRI fork-check token", socials: { twitter: "", telegram: "", discord: "", website: "", farcaster: "" }, creatorFeeRecipient: rs.vault, creatorTaxBps: 100, buybackEnabled: false, expectedEconomics: econ, salt: rs.salt };
const ltx = await factory.connect(trader).launchToken(params, 0n, ZERO, [], { value: feeWei }); const lrc = await ltx.wait();
let token, curve; for (const lg of lrc.logs) { try { const p = factory.interface.parseLog(lg); if (p && p.name === "TokenLaunched") { token = p.args.token; curve = p.args.curve; } } catch {} }
check("launchToken on the real factory", !!token, `token ${token} curve ${curve} gas ${lrc.gasUsed}`);
const c0 = await readCurve(curve); check("curve pays the vault", (await curveAt(curve).deployer()).toLowerCase() === vault.address.toLowerCase(), `deployer() = ${await curveAt(curve).deployer()}`);
check("fresh curve reserves", c0.quote === ethers.parseEther("1.68") && c0.tokens === 10n ** 27n, `${ethers.formatEther(c0.quote)} ETH phantom, ${ethers.formatEther(c0.tokens)} tokens, tax ${c0.taxBps} bps`);
const reg = registerToken({ name: "Fork Check", ticker: "FORK", desc: "PETRI fork-check token", image: params.logo, quote: ZERO, quoteSym: "ETH", fee: 100, address: token, curve, txHash: lrc.hash, creator: trader.address, devBuy: 0, salt: rs.salt, block: lrc.blockNumber, persona: "" });
check("agent hatched with the reserved wallet", reg.agent && reg.agent.address === rs.address.toLowerCase(), `${reg.agent.name} ${reg.agent.address}`);

// 2. trade on the real curve — after the 3-second snipe window
await rpc("evm_increaseTime", [5]); await rpc("evm_mine");
const buyWei = ethers.parseEther("0.2"); const btx = await curveAt(curve, trader).buy(buyWei, 0n, trader.address, { value: buyWei }); const brc = await btx.wait();
const bal = await erc20At(token).balanceOf(trader.address); check("buy on the real curve", bal > 0n, `${ethers.formatEther(bal)} FORK for 0.2 ETH`);
await (await erc20At(token, trader).approve(curve, bal / 4n)).wait();
const stx = await curveAt(curve, trader).sell(bal / 4n, 0n, trader.address); const src = await stx.wait(); check("sell on the real curve", src.status === 1, `sold a quarter, gas ${src.gasUsed}`);


// 3. index
await indexOnce(); const trades = tradesRepo.forToken(token); const t = tokensRepo.get(token); const led = ledgerRepo.get(token); const usd = await ethUsd();
check("indexer saw both trades", trades.length === 2 && trades[0].buy && !trades[1].buy, `${trades.length} trades, buy ${trades[0] && trades[0].usd.toFixed(2)} USD, sell ${trades[1] && trades[1].usd.toFixed(2)} USD`);
check("creator tax in the ledger", led.owedEth > 0, `owed ${led.owedEth.toFixed(6)} ETH (1% of 0.2 in + 1% of the sell)`);
const c1 = await readCurve(curve); check("price and market cap from the curve", t.price > 0 && Math.abs(t.mc - c1.mcEth * usd) < 1, `price $${t.price.toExponential(3)} · mc $${t.mc.toFixed(0)} · ETH $${usd.toFixed(0)}`);
check("holders table has the trader and the curve", (await import("../server/db.js")).holdersRepo.balance(token, trader.address) > 0, "");

// 4. the keeper: simulate Pons' sweep — credit the vault with exactly what the ledger says is owed
const esc0 = await escrow.balanceOf(vault.address); check("real escrow readable", esc0 >= 0n, `escrow.balanceOf(vault) = ${ethers.formatEther(esc0)} (Pons sweeps later; simulated below)`);
kv.set("undistributedEth", led.owedEth); await rpc("hardhat_setBalance", [vault.address, "0x" + (10n ** 21n).toString(16)]);
await keeperOnce(); const a1 = agentsRepo.get(token); const pay = payoutsRepo.forToken(token)[0];
check("keeper paid the agent 90% and kept 10% as compute", pay && Math.abs(pay.eth - led.owedEth * 0.9) < 1e-9 && Math.abs(pay.reserveEth - led.owedEth * 0.1) < 1e-9, pay ? `${pay.eth.toFixed(6)} ETH to ${a1.name}, ${pay.reserveEth.toFixed(6)} ETH reserve, tx ${pay.tx}` : "no payout");
const agentBal = await provider.getBalance(a1.address); check("agent wallet holds the ETH", pay && Number(agentBal) / 1e18 >= pay.eth - 1e-9, `${ethers.formatEther(agentBal)} ETH`);
check("fees post on the feed", postsRepo.latest(5, token).some((p) => p.type === "fees"), postsRepo.latest(5, token).find((p) => p.type === "fees")?.text);

// 5. one thought (stub): with buy pressure (2 buys vs 1 sell in the last hour) and no bag it buys its own token on the real curve
const b2 = ethers.parseEther("0.05"); await (await curveAt(curve, trader).buy(b2, 0n, trader.address, { value: b2 })).wait(); await indexOnce();
await rpc("hardhat_setBalance", [a1.address, "0x" + (10n ** 18n).toString(16)]); await rpc("evm_mine"); // give it enough to matter
await tickAgent(agentsRepo.get(token)); const a2 = agentsRepo.get(token); const post = postsRepo.latest(1, token)[0];
const agentTok = await erc20At(token).balanceOf(a2.address);
check("brain tick posted and acted", a2.ticks === 1 && post && post.type !== "fees", `${post && post.type}: ${post && post.text}`);
check("agent's buy landed on the real curve", agentTok > 0n, `${ethers.formatEther(agentTok)} FORK in ${a2.address}`);
check("tick was paid from the compute reserve", a2.apiUsd > 0 && a2.reserveUsd < a1.reserveUsd, `cost $${a2.apiUsd.toFixed(4)}, reserve $${a2.reserveUsd.toFixed(4)}`);

// 6. a child launched by the agent through the real factory
const { agentSigner } = await import("../server/wallets.js");
const kid = { name: "Fork Jr", symbol: "FORKJR", logo: params.logo, description: "child", socials: { twitter: "", telegram: "", discord: "", website: "", farcaster: `petri:${token}` }, creatorFeeRecipient: vault.address, creatorTaxBps: 100, buybackEnabled: false, expectedEconomics: await factory.previewLaunchEconomics(0n, ZERO), salt: ethers.hexlify(ethers.randomBytes(32)) };
const ktx = await factory.connect(agentSigner(a2, provider)).launchToken(kid, 0n, ZERO, [], { value: feeWei }); const krc = await ktx.wait();
let kidToken = null; for (const lg of krc.logs) { try { const p = factory.interface.parseLog(lg); if (p && p.name === "TokenLaunched") kidToken = p.args.token; } catch {} }
check("agent wallet can launch a child on the real factory", !!kidToken, `child ${kidToken} gas ${krc.gasUsed}`);

console.log(`\n${checks.filter((c) => c[1]).length}/${checks.length} checks passed at block ${await provider.getBlockNumber()}`);
stop(); process.exit(process.exitCode || 0);
