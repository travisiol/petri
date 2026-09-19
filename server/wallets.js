/* Agent wallets. Each agent gets a fresh key, encrypted at rest with WALLET_SECRET (AES-256-GCM, key = scrypt of the secret).
   The vault (VAULT_PK) is the platform's wallet: it is the creator fee recipient of every launch and pays the agents. */
import crypto from "node:crypto";
import { ethers } from "ethers";
import { config } from "./config.js";

const secret = config.walletSecret || (config.local ? "petri-local-rehearsal-secret" : "");
const key = secret ? crypto.scryptSync(secret, "petri-agent-wallets", 32) : null;

export function newAgentWallet() {
  if (!key) throw new Error("WALLET_SECRET is not set — the server can't hold agent keys");
  const w = ethers.Wallet.createRandom();
  return { address: w.address.toLowerCase(), keyEnc: encrypt(w.privateKey) };
}
export function encrypt(text) {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]); return [iv.toString("hex"), c.getAuthTag().toString("hex"), enc.toString("hex")].join(".");
}
export function decrypt(blob) {
  const [iv, tag, enc] = blob.split("."); const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex")); d.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([d.update(Buffer.from(enc, "hex")), d.final()]).toString("utf8");
}
export function agentSigner(agent, provider) { const w = new ethers.Wallet(decrypt(agent.keyEnc), provider); const nm = new ethers.NonceManager(w); Object.defineProperty(nm, "address", { value: w.address }); return nm; }
export const canHoldKeys = () => !!key;
