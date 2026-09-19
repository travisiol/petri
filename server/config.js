/* PETRI server configuration — everything comes from the environment (see .env.example).
   LOCAL=1 (set by scripts/local.mjs) points at the rehearsal network and chain/local.json. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv(path.join(root, ".env"));

const num = (k, d) => (process.env[k] != null && process.env[k] !== "" ? Number(process.env[k]) : d);
const str = (k, d = "") => (process.env[k] != null && process.env[k] !== "" ? String(process.env[k]).trim() : d);

const LOCAL = str("LOCAL") === "1";
let local = null;
if (LOCAL) {
  try { local = JSON.parse(fs.readFileSync(path.join(root, "chain", "local.json"), "utf8")); } catch { /* deploy first */ }
}

export const config = {
  root,
  name: "petri",
  port: num("PORT", 3719),
  dataDir: path.resolve(root, str("DATA_DIR", "./data")),
  local: LOCAL,
  /* a hardhat node (local network or fork): nonce reads use "latest", see chain.js */
  hardhat: LOCAL || str("HARDHAT") === "1",
  rpcUrl: str("RPC_URL", local ? local.rpc : "https://rpc.mainnet.chain.robinhood.com"),
  chainId: num("CHAIN_ID", local ? local.chainId : 4663),
  chainName: LOCAL ? "Robinhood Chain (local)" : "Robinhood Chain",
  explorer: str("EXPLORER", "https://robinhoodchain.blockscout.com"),
  pons: {
    factory: str("PONS_FACTORY", local ? local.factory : "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e"),
    forwarder: str("PONS_FORWARDER", local ? local.forwarder : "0xe33E9E479dF8802cb0866d5d05258bEc4cF62948"),
    escrow: str("PONS_ESCROW", local ? local.escrow : "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e"),
    tradeUrl: (a) => "https://www.ponsfamily.com/launchpad/" + a,
  },
  vaultPk: str("VAULT_PK"),
  walletSecret: str("WALLET_SECRET"),
  adminKey: str("ADMIN_KEY"),
  brain: { model: str("BRAIN_MODEL", "claude-opus-5"), mode: str("BRAIN", "auto"), apiKey: str("ANTHROPIC_API_KEY") },
  tickMs: num("TICK_MS", 120000),
  claimMs: num("CLAIM_MS", 60000),
  indexMs: num("INDEX_MS", 15000),
  starveMs: num("STARVE_MS", 172800000),
  /* every fee is split this way: the agent's wallet gets the rest, the vault keeps the compute share */
  computeShare: 0.1,
  /* the agent never spends below this — gas for the next move */
  gasFloorEth: 0.0005,
  /* payouts smaller than this wait for the next minute */
  minPayoutEth: 0.0002,
  socialX: str("SOCIAL_X", "https://x.com/petri"),
};

function loadDotenv(file) {
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/.exec(line);
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
  } catch { /* no .env */ }
}
