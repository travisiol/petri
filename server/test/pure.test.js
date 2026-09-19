// node --test server/test — the pure parts: the curve math against numbers measured on the real curve,
// the stub brain's rules, the model pricing, and the database repos on a throwaway file.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "petri-test-"));
process.env.LOCAL = ""; process.env.VAULT_PK = ""; process.env.WALLET_SECRET = "test-secret";
const { quoteBuy, quoteSell, marketCap, spot, withSlippage } = await import("../pons.js");
const { stubThink, costOf } = await import("../llm.js");
const { tokensRepo, agentsRepo, postsRepo, tradesRepo, holdersRepo, ledgerRepo, kv } = await import("../db.js");
const { newAgentWallet, decrypt } = await import("../wallets.js");

const E = (x) => ethers.parseEther(String(x));
const PHANTOM = E("1.68"), SUPPLY = 10n ** 27n;

test("curve math matches the real curve to the wei-ish", () => {
  // 0.01 ETH on a fresh curve, 1% fee: 5 858 334.8127… tokens (measured on a fork)
  const out = quoteBuy(PHANTOM, SUPPLY, E("0.01"), 100n);
  assert.ok(Math.abs(Number(ethers.formatEther(out)) - 5858334.812710811) < 1e-6);
  // 0.05 ETH: 28 620 988.725065… then selling half gives back 0.0248582336… ETH
  const out2 = quoteBuy(PHANTOM, SUPPLY, E("0.05"), 100n);
  assert.ok(Math.abs(Number(ethers.formatEther(out2)) - 28620988.725065047) < 1e-6);
  const net = E("0.05") - E("0.05") / 100n;
  const back = quoteSell(PHANTOM + net, SUPPLY - out2, out2 / 2n, 100n);
  assert.ok(Math.abs(Number(ethers.formatEther(back)) - 0.024858233611966564) < 1e-9, ethers.formatEther(back));
  assert.equal(withSlippage(1000n, 500), 950n);
  assert.ok(Math.abs(marketCap(PHANTOM, SUPPLY) - 1.68) < 1e-12);
  assert.ok(spot(PHANTOM, SUPPLY) > 0);
});

test("stub brain: buys its own token on buy pressure, holds when thin, launches when rich", () => {
  const sheet = (o) => "Tick 1. The sheet:\n" + JSON.stringify({ agentName: "specimen-01", walletEth: 0.2, gasFloor: 0.0005, ticks: 5, children: 0, holdings: [], board: [], feed: [], lastOther: null, ...o });
  const own = { address: "0xaaa", name: "Own", ticker: "OWN", price: 1e-6, mc: 5000, chg24: 12, vol24: 300, buys24: 5, sells24: 1, graduated: false };
  const d1 = stubThink(sheet({ own })).decision; assert.equal(d1.action, "buy"); assert.equal(d1.token, "0xaaa"); assert.ok(d1.eth > 0 && d1.eth <= 0.2);
  const d2 = stubThink(sheet({ own, walletEth: 0.001 })).decision; assert.equal(d2.action, "hold"); assert.match(d2.say, /thin/);
  const d3 = stubThink(sheet({ own: { ...own, chg24: -20 }, holdings: [{ token: "0xaaa", ticker: "OWN", tokens: 1e6, usd: 1 }] })).decision; assert.equal(d3.action, "sell"); assert.equal(d3.pct, 50);
  const d4 = stubThink(sheet({ own: { ...own, buys24: 0, sells24: 0, chg24: 0, mc: 9000 }, holdings: [{ token: "0xaaa", ticker: "OWN", tokens: 1, usd: 0 }], walletEth: 0.5 })).decision; assert.equal(d4.action, "launch"); assert.ok(d4.launch.ticker.length <= 8);
  assert.ok(stubThink(sheet({ own })).cost > 0.005);
});

test("model pricing from usage", () => {
  const c = costOf("claude-opus-5", { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 2000 });
  assert.ok(Math.abs(c - (1000 * 5 + 100 * 25 + 2000 * 0.5) / 1e6) < 1e-12);
  assert.ok(costOf("claude-sonnet-5", { input_tokens: 1000 }) < costOf("claude-opus-5", { input_tokens: 1000 }));
});

test("wallet keys round-trip through encryption", () => {
  const w = newAgentWallet(); assert.match(w.address, /^0x[0-9a-f]{40}$/); assert.ok(!w.keyEnc.includes(w.address));
  assert.equal(new ethers.Wallet(decrypt(w.keyEnc)).address.toLowerCase(), w.address);
});

test("repos: token, agent, trades, ledger, holders, posts", () => {
  const address = "0x" + "1".repeat(40), curve = "0x" + "2".repeat(40), creator = "0x" + "3".repeat(40);
  tokensRepo.insert({ address, curve, name: "Test", ticker: "TEST", quote: ethers.ZeroAddress, quoteSym: "ETH", fee: 100, creator, ts: Date.now(), block: 10 });
  assert.equal(tokensRepo.get(address.toUpperCase()).ticker, "TEST");
  const w = newAgentWallet(); agentsRepo.insert({ token: address, address: w.address, keyEnc: w.keyEnc, name: "specimen-01", bornAt: Date.now() });
  agentsRepo.update(address, { feesUsd: 12.5, reserveUsd: 1.25 }); assert.equal(agentsRepo.get(address).feesUsd, 12.5);
  tradesRepo.insert({ token: address, ts: Date.now() - 1000, block: 11, li: 0, buy: true, quoteEth: 0.1, usd: 260, tokens: 5e7, price: 5.2e-6, taxEth: 0.001, tax: 2.6, tx: "0xab", who: creator });
  tradesRepo.insert({ token: address, ts: Date.now() - 1000, block: 11, li: 0, buy: true, quoteEth: 0.1, usd: 260, tokens: 5e7, price: 5.2e-6, taxEth: 0.001, tax: 2.6, tx: "0xab", who: creator }); // same log twice: ignored
  assert.equal(tradesRepo.count(address), 1); assert.equal(tradesRepo.vol24(address), 260);
  ledgerRepo.add(address, 0.001); ledgerRepo.pay(address, 0.0004, Date.now()); const l = ledgerRepo.get(address); assert.ok(Math.abs(l.owedEth - 0.0006) < 1e-12 && l.paidEth === 0.0004);
  holdersRepo.apply(address, curve, 1e9, 1); holdersRepo.apply(address, curve, -5e7, 2); holdersRepo.apply(address, creator, 5e7, 2);
  assert.equal(holdersRepo.top(address)[0].addr, curve); assert.equal(holdersRepo.count(address), 2);
  postsRepo.insert({ id: "p1", token: address, agent: "specimen-01", ticker: "TEST", text: "hi", at: Date.now(), type: "hold", did: { ok: true, note: "x" } });
  postsRepo.upvote("p1"); assert.equal(postsRepo.latest(5)[0].votes, 1); assert.equal(postsRepo.latest(5)[0].did.note, "x");
  kv.add("n", 2); kv.add("n", 3); assert.equal(kv.get("n"), 5);
});
