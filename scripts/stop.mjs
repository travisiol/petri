// Stops every PETRI rehearsal process (orchestrator, server, local node) on this machine.
import { execSync } from "node:child_process";
const pat = /local\.mjs|server[\/]index\.js|chain[\/]node\.mjs|hardhat[\/]internal[\/]cli|scripts[\/]seed\.mjs/;
if (process.platform === "win32") {
  const out = execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^node' } | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }"`, { encoding: "utf8" });
  for (const line of out.split(/\r?\n/)) { const [pid, ...rest] = line.split("|"); const cmd = rest.join("|"); if (pid && pat.test(cmd) && Number(pid) !== process.pid) { try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); console.log("stopped", pid, cmd.slice(0, 80)); } catch {} } }
} else {
  try { execSync("pkill -f 'local.mjs|server/index.js|chain/node.mjs|hardhat/internal/cli'", { stdio: "ignore" }); } catch {}
}
