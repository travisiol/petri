// Deploys the Pons look-alike on the local network and writes chain/local.json,
// which the server reads (LOCAL=1) to override the mainnet Pons addresses.
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const RPC = process.env.RPC_URL || "http://127.0.0.1:8719";
const art = (n) => JSON.parse(fs.readFileSync(path.join(here, "artifacts", "contracts", "MockPons.sol", n + ".json"), "utf8"));
const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true, batchMaxCount: 1 });
const deployer = await provider.getSigner(0);
const deploy = async (name, ...args) => { const a = art(name); const f = new ethers.ContractFactory(a.abi, a.bytecode, deployer); const c = await f.deploy(...args); await c.waitForDeployment(); return c; };
const escrow = await deploy("MockEscrow");
const factory = await deploy("MockFactory", await escrow.getAddress());
const forwarder = await deploy("MockForwarder", await factory.getAddress());
await (await factory.setForwarder(await forwarder.getAddress())).wait();
const accounts = (await provider.listAccounts()).map((s) => s.address);
const out = { rpc: RPC, chainId: Number((await provider.getNetwork()).chainId), factory: await factory.getAddress(), forwarder: await forwarder.getAddress(), escrow: await escrow.getAddress(), accounts, deployedAt: Date.now() };
fs.writeFileSync(path.join(here, "local.json"), JSON.stringify(out, null, 2));
console.log("mock Pons deployed", out);
