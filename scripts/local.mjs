// One command rehearsal: local network (mock Pons) → server with the vault → seeded tokens, trades, agents.
//   npm run local            keeps everything running; Ctrl-C stops it all
//   SEED=none npm run local  an empty dish
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT || "3719", CHAIN_PORT = process.env.CHAIN_PORT || "8719";
const RPC = `http://127.0.0.1:${CHAIN_PORT}`;
const HH = ["0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"]; // hardhat #0 = the vault
const kids = [];
const run = (cmd, args, env, name) => { const c = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" }); c.stdout.on("data", (d) => process.stdout.write(`[${name}] ${d}`)); c.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`)); kids.push(c); return c; };
const stop = () => { for (const k of kids) { try { process.platform === "win32" ? spawn("taskkill", ["/pid", String(k.pid), "/t", "/f"]) : k.kill(); } catch {} } };
process.on("SIGINT", () => { stop(); process.exit(0); }); process.on("SIGTERM", () => { stop(); process.exit(0); });
const rpc = async (method, params = []) => { const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); return (await r.json()).result; };
const waitFor = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw new Error("timeout"); };

// fresh data for every rehearsal
let data = path.join(root, "data-local"); try { fs.rmSync(data, { recursive: true, force: true }); } catch { data = path.join(root, "data-local-" + Date.now()); } fs.mkdirSync(data, { recursive: true });
run("node", ["chain/node.mjs"], { CHAIN_PORT, INITIAL_DATE: new Date(Date.now() - 75 * 60e3).toISOString() }, "chain");
await waitFor(() => rpc("eth_blockNumber").then((r) => !!r));
await new Promise((res, rej) => { const d = run("node", ["chain/deploy.mjs"], { RPC_URL: RPC }, "deploy"); d.on("exit", (c) => (c ? rej(new Error("deploy failed")) : res())); });
const env = { LOCAL: "1", PORT, RPC_URL: RPC, DATA_DIR: data, VAULT_PK: HH[0], WALLET_SECRET: "petri-local-rehearsal-secret", ADMIN_KEY: "local-admin", TICK_MS: process.env.TICK_MS || "25000", CLAIM_MS: process.env.CLAIM_MS || "20000", INDEX_MS: process.env.INDEX_MS || "4000", STARVE_MS: process.env.STARVE_MS || "600000", PUBLIC_URL: `http://127.0.0.1:${PORT}`, EXPLORER: "https://robinhoodchain.blockscout.com" };
run("node", ["server/index.js"], env, "server");
await waitFor(() => fetch(`http://127.0.0.1:${PORT}/api/stack`).then((r) => r.ok));
if (process.env.SEED !== "none") await new Promise((res) => { const s = run("node", ["scripts/seed.mjs"], { ...env, SEED_RPC: RPC }, "seed"); s.on("exit", res); });
console.log(`\n  PETRI rehearsal is up → http://127.0.0.1:${PORT}\n  dev wallet: add ?devwallet to any page (hardhat account #5, unlocked on the local node)\n`);
