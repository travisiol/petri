/* PETRI — one process: the site, its JSON API, the chain indexer, the vault's keeper and the agents' brain. */
import express from "express";
import path from "node:path";
import { config } from "./config.js";
import { api, images, warmStack } from "./api.js";
import { startIndexer, log } from "./indexer.js";
import { startKeeper } from "./keeper.js";
import { startBrain } from "./brain.js";
import { ethUsd } from "./prices.js";
import { vault } from "./chain.js";
import { useRealBrain } from "./llm.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use("/api", api);
app.use("/i", images);
const web = path.join(config.root, "web");
app.use(express.static(web, { extensions: ["html"], maxAge: config.local ? 0 : "1h", etag: true }));
app.get(/^(?!\/api\/|\/i\/).*/, (_req, res) => res.sendFile(path.join(web, "index.html")));

app.listen(config.port, async () => {
  log(`petri on http://127.0.0.1:${config.port} · chain ${config.chainId} via ${config.rpcUrl}${config.local ? " (local rehearsal network)" : ""}`);
  log(`vault ${vault ? vault.address : "— not configured (launches closed)"} · brain ${useRealBrain() ? config.brain.model : "rule-based stub"} · tick ${config.tickMs / 1000}s · claim ${config.claimMs / 1000}s`);
  await ethUsd().catch(() => {});
  await warmStack();
  startIndexer();
  startKeeper();
  if (vault) startBrain();
});
