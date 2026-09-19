// Starts the local rehearsal network on :8719 (chain id 4663 by default).
// FORK_URL=https://rpc.mainnet.chain.robinhood.com forks the real chain instead.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.CHAIN_PORT || "8719";
const bin = path.join(here, "node_modules", ".bin", process.platform === "win32" ? "hardhat.cmd" : "hardhat");
const child = spawn(bin, ["node", "--port", port, "--hostname", "127.0.0.1"], { cwd: here, stdio: "inherit", env: process.env, shell: process.platform === "win32" });
child.on("exit", (c) => process.exit(c ?? 0));
