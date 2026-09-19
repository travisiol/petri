/* The chain: one provider, the vault signer, contract handles, and reads the rest of the server shares. */
import { ethers } from "ethers";
import { config } from "./config.js";
import { CURVE_ABI, ERC20_ABI, ESCROW_ABI, FACTORY_ABI, FORWARDER_ABI, MOCK_CURVE_ABI, marketCap, spot } from "./pons.js";

/* hardhat's "pending" nonce goes stale once its clock is shifted (evm_increaseTime), so the rehearsal reads "latest" */
class Provider extends ethers.JsonRpcProvider { getTransactionCount(a, tag) { return super.getTransactionCount(a, config.hardhat && tag === "pending" ? "latest" : tag); } }
/* cacheTimeout -1: ethers otherwise serves any read repeated within 250 ms from cache — the indexer would miss the newest block */
export const provider = new Provider(config.rpcUrl, config.chainId, { staticNetwork: ethers.Network.from(config.chainId), batchMaxCount: 1, pollingInterval: config.local ? 1000 : 3000, cacheTimeout: -1 });
/* signers count their own nonces (NonceManager): ethers re-reads a stale count between two quick sends otherwise */
export function managed(wallet) { const nm = new ethers.NonceManager(wallet); Object.defineProperty(nm, "address", { value: wallet.address }); return nm; }
export const vault = config.vaultPk ? managed(new ethers.Wallet(config.vaultPk, provider)) : null;
export const vaultAddress = vault ? vault.address.toLowerCase() : null;
export const isNonceError = (e) => /nonce/i.test(String((e && (e.shortMessage || e.message)) || ""));

export const factory = new ethers.Contract(config.pons.factory, FACTORY_ABI, provider);
export const forwarder = new ethers.Contract(config.pons.forwarder, FORWARDER_ABI, provider);
export const escrow = new ethers.Contract(config.pons.escrow, ESCROW_ABI, provider);
export const curveAt = (a, signer) => new ethers.Contract(a, config.local ? MOCK_CURVE_ABI : CURVE_ABI, signer || provider);
export const erc20At = (a, signer) => new ethers.Contract(a, ERC20_ABI, signer || provider);

const blockTs = new Map();
export async function blockTime(n) {
  if (blockTs.has(n)) return blockTs.get(n);
  const b = await provider.getBlock(n); const t = b ? Number(b.timestamp) * 1000 : Date.now();
  if (blockTs.size > 5000) blockTs.clear(); blockTs.set(n, t); return t;
}

/* the curve's state in one round: reserves, graduation, fee rates */
export async function readCurve(curveAddr) {
  const c = curveAt(curveAddr);
  const [res, graduated, feeBps, taxBps] = await Promise.all([c.getReserves(), c.graduated().catch(() => false), c.feeBps().catch(() => 100n), c.creatorTaxBps().catch(() => 0n)]);
  const quote = res[0], tokens = res[1];
  return { quote, tokens, graduated: !!graduated, feeBps: Number(feeBps), taxBps: Number(taxBps), spotEth: spot(quote, tokens), mcEth: marketCap(quote, tokens) };
}

export const launchFeeWei = async () => factory.launchFee();
export const fmtEth = (wei) => Number(ethers.formatEther(wei));
export const getBalanceEth = async (a) => fmtEth(await provider.getBalance(a));
export const ethers_ = ethers;
