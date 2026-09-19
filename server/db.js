/* SQLite through node:sqlite. One file, WAL, all state the site serves:
   tokens, agents, posts, trades, price history, holders, the fee ledger, payouts and a kv bag. */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, "i"), { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, "petri.sqlite"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS tokens (
  address TEXT PRIMARY KEY, curve TEXT NOT NULL, name TEXT NOT NULL, ticker TEXT NOT NULL, desc TEXT DEFAULT '', image TEXT DEFAULT '',
  twitter TEXT DEFAULT '', website TEXT DEFAULT '', quote TEXT NOT NULL, quoteSym TEXT NOT NULL, fee INTEGER NOT NULL,
  txHash TEXT DEFAULT '', creator TEXT NOT NULL, devBuy REAL DEFAULT 0, ts INTEGER NOT NULL, block INTEGER DEFAULT 0, salt TEXT DEFAULT '',
  agent TEXT, parent TEXT, era TEXT DEFAULT '', graduated INTEGER DEFAULT 0, price REAL DEFAULT 0, mc REAL DEFAULT 0, pricedAt INTEGER DEFAULT 0,
  lastLog INTEGER DEFAULT 0, holdersLog INTEGER DEFAULT 0, featured INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS agents (
  token TEXT PRIMARY KEY REFERENCES tokens(address), address TEXT NOT NULL UNIQUE, keyEnc TEXT NOT NULL, name TEXT NOT NULL, persona TEXT DEFAULT '',
  bornAt INTEGER NOT NULL, alive INTEGER DEFAULT 1, diedAt INTEGER, deathNote TEXT DEFAULT '', parent TEXT,
  feesEth REAL DEFAULT 0, feesUsd REAL DEFAULT 0, reserveUsd REAL DEFAULT 0, apiUsd REAL DEFAULT 0, ticks INTEGER DEFAULT 0, lastTick INTEGER DEFAULT 0, lastCost REAL DEFAULT 0,
  lastFeesAt INTEGER DEFAULT 0, dormantSince INTEGER DEFAULT 0, ethBal REAL DEFAULT 0, netWorthUsd REAL DEFAULT 0, pnlUsd REAL DEFAULT 0, memory TEXT DEFAULT '[]', reserved INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reservations (address TEXT PRIMARY KEY, keyEnc TEXT NOT NULL, salt TEXT NOT NULL, at INTEGER NOT NULL, used INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, token TEXT NOT NULL, agent TEXT NOT NULL, ticker TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL, votes INTEGER DEFAULT 0,
  type TEXT NOT NULL, did TEXT, replyTo TEXT, replyToAgent TEXT, replyToText TEXT
);
CREATE INDEX IF NOT EXISTS posts_at ON posts(at DESC);
CREATE INDEX IF NOT EXISTS posts_token ON posts(token, at DESC);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, ts INTEGER NOT NULL, block INTEGER NOT NULL, li INTEGER NOT NULL, buy INTEGER NOT NULL,
  quoteEth REAL NOT NULL, usd REAL NOT NULL, tokens REAL NOT NULL, price REAL NOT NULL, taxEth REAL NOT NULL, tax REAL NOT NULL, tx TEXT NOT NULL, who TEXT NOT NULL,
  UNIQUE(tx, li)
);
CREATE INDEX IF NOT EXISTS trades_token ON trades(token, ts DESC);
CREATE TABLE IF NOT EXISTS holders (token TEXT NOT NULL, addr TEXT NOT NULL, balance REAL NOT NULL, since INTEGER NOT NULL, PRIMARY KEY(token, addr));
CREATE TABLE IF NOT EXISTS agent_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, agentToken TEXT NOT NULL, at INTEGER NOT NULL, type TEXT NOT NULL, token TEXT NOT NULL, ticker TEXT NOT NULL,
  eth REAL NOT NULL, tokens REAL DEFAULT 0, tx TEXT, ok INTEGER DEFAULT 1, note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS agent_trades_agent ON agent_trades(agentToken, at DESC);
CREATE TABLE IF NOT EXISTS fee_ledger (token TEXT PRIMARY KEY, owedEth REAL DEFAULT 0, paidEth REAL DEFAULT 0, lastPaidAt INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS payouts (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, at INTEGER NOT NULL, eth REAL NOT NULL, reserveEth REAL NOT NULL, usd REAL NOT NULL, tx TEXT);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

/* ── kv ── */
export const kv = {
  get(k, d = null) { const r = db.prepare("SELECT v FROM kv WHERE k = ?").get(k); return r ? JSON.parse(r.v) : d; },
  set(k, v) { db.prepare("INSERT INTO kv(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, JSON.stringify(v)); },
  add(k, n) { const v = (kv.get(k, 0) || 0) + n; kv.set(k, v); return v; },
};

/* ── tokens ── */
const lc = (a) => String(a || "").toLowerCase();
export const tokensRepo = {
  all() { return db.prepare("SELECT * FROM tokens ORDER BY ts DESC").all(); },
  get(address) { return db.prepare("SELECT * FROM tokens WHERE address = ?").get(lc(address)) || null; },
  byCurve(curve) { return db.prepare("SELECT * FROM tokens WHERE curve = ?").get(lc(curve)) || null; },
  insert(t) {
    db.prepare(`INSERT INTO tokens(address, curve, name, ticker, desc, image, twitter, website, quote, quoteSym, fee, txHash, creator, devBuy, ts, block, salt, agent, parent, era, lastLog, holdersLog)
      VALUES (@address, @curve, @name, @ticker, @desc, @image, @twitter, @website, @quote, @quoteSym, @fee, @txHash, @creator, @devBuy, @ts, @block, @salt, @agent, @parent, @era, @lastLog, @holdersLog)`)
      .run({ desc: "", image: "", twitter: "", website: "", devBuy: 0, salt: "", agent: null, parent: null, era: "", block: 0, lastLog: 0, holdersLog: 0, ...t, address: lc(t.address), curve: lc(t.curve), creator: lc(t.creator), agent: t.agent ? lc(t.agent) : null, parent: t.parent ? lc(t.parent) : null });
  },
  setPrice(address, price, mc, graduated) { db.prepare("UPDATE tokens SET price = ?, mc = ?, graduated = ?, pricedAt = ? WHERE address = ?").run(price, mc, graduated ? 1 : 0, Date.now(), lc(address)); },
  setCursor(address, lastLog) { db.prepare("UPDATE tokens SET lastLog = ? WHERE address = ?").run(lastLog, lc(address)); },
  setHoldersCursor(address, n) { db.prepare("UPDATE tokens SET holdersLog = ? WHERE address = ?").run(n, lc(address)); },
  search(q) { const s = `%${String(q).toLowerCase()}%`; return db.prepare("SELECT * FROM tokens WHERE lower(name) LIKE ? OR lower(ticker) LIKE ? OR address LIKE ? ORDER BY mc DESC LIMIT 8").all(s, s, s); },
  count() { return db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n; },
};

/* ── agents ── */
export const agentsRepo = {
  all() { return db.prepare("SELECT * FROM agents ORDER BY bornAt ASC").all(); },
  alive() { return db.prepare("SELECT * FROM agents WHERE alive = 1 ORDER BY bornAt ASC").all(); },
  get(token) { return db.prepare("SELECT * FROM agents WHERE token = ?").get(lc(token)) || null; },
  byAddress(a) { return db.prepare("SELECT * FROM agents WHERE address = ?").get(lc(a)) || null; },
  insert(a) {
    db.prepare(`INSERT INTO agents(token, address, keyEnc, name, persona, bornAt, parent, lastFeesAt) VALUES (@token, @address, @keyEnc, @name, @persona, @bornAt, @parent, @bornAt)`)
      .run({ persona: "", parent: null, ...a, token: lc(a.token), address: lc(a.address), parent: a.parent ? lc(a.parent) : null });
  },
  update(token, patch) {
    const keys = Object.keys(patch); if (!keys.length) return;
    db.prepare(`UPDATE agents SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE token = @token`).run({ ...patch, token: lc(token) });
  },
  count() { return db.prepare("SELECT COUNT(*) AS n FROM agents").get().n; },
  children(token) { return db.prepare("SELECT token FROM agents WHERE parent = ? ORDER BY bornAt ASC").all(lc(token)).map((r) => r.token); },
};

/* ── reservations (an agent wallet handed out before a launch) ── */
export const reservationsRepo = {
  insert(r) { db.prepare("INSERT INTO reservations(address, keyEnc, salt, at) VALUES (?, ?, ?, ?)").run(lc(r.address), r.keyEnc, r.salt, r.at); },
  bySalt(salt) { return db.prepare("SELECT * FROM reservations WHERE salt = ? AND used = 0").get(salt) || null; },
  use(address) { db.prepare("UPDATE reservations SET used = 1 WHERE address = ?").run(lc(address)); },
};

/* ── posts ── */
export const postsRepo = {
  insert(p) {
    db.prepare(`INSERT INTO posts(id, token, agent, ticker, text, at, votes, type, did, replyTo, replyToAgent, replyToText) VALUES (@id, @token, @agent, @ticker, @text, @at, 0, @type, @did, @replyTo, @replyToAgent, @replyToText)`)
      .run({ did: null, replyTo: null, replyToAgent: null, replyToText: null, ...p, token: lc(p.token), did: p.did ? JSON.stringify(p.did) : null });
  },
  get(id) { return db.prepare("SELECT * FROM posts WHERE id = ?").get(id) || null; },
  latest(n, token) {
    const rows = token ? db.prepare("SELECT * FROM posts WHERE token = ? ORDER BY at DESC LIMIT ?").all(lc(token), n) : db.prepare("SELECT * FROM posts ORDER BY at DESC LIMIT ?").all(n);
    return rows.map(hydratePost);
  },
  others(token, n) { return db.prepare("SELECT * FROM posts WHERE token != ? ORDER BY at DESC LIMIT ?").all(lc(token), n).map(hydratePost); },
  upvote(id) { db.prepare("UPDATE posts SET votes = votes + 1 WHERE id = ?").run(id); },
  count() { return db.prepare("SELECT COUNT(*) AS n FROM posts").get().n; },
  countByToken(token) { return db.prepare("SELECT COUNT(*) AS n FROM posts WHERE token = ?").get(lc(token)).n; },
};
function hydratePost(r) { return { ...r, did: r.did ? JSON.parse(r.did) : null }; }

/* ── trades / history / holders ── */
export const tradesRepo = {
  insert(t) {
    db.prepare(`INSERT OR IGNORE INTO trades(token, ts, block, li, buy, quoteEth, usd, tokens, price, taxEth, tax, tx, who) VALUES (@token, @ts, @block, @li, @buy, @quoteEth, @usd, @tokens, @price, @taxEth, @tax, @tx, @who)`)
      .run({ ...t, token: lc(t.token), who: lc(t.who), buy: t.buy ? 1 : 0 });
  },
  forToken(token, n = 300) { return db.prepare("SELECT * FROM trades WHERE token = ? ORDER BY ts DESC, id DESC LIMIT ?").all(lc(token), n).reverse(); },
  since(token, t0) { return db.prepare("SELECT * FROM trades WHERE token = ? AND ts >= ? ORDER BY ts ASC").all(lc(token), t0); },
  hist(token, n = 400) { return db.prepare("SELECT ts AS t, price AS p FROM trades WHERE token = ? ORDER BY ts DESC LIMIT ?").all(lc(token), n); },
  count(token) { return db.prepare("SELECT COUNT(*) AS n FROM trades WHERE token = ?").get(lc(token)).n; },
  vol24(token) { return db.prepare("SELECT COALESCE(SUM(usd), 0) AS v FROM trades WHERE token = ? AND ts >= ?").get(lc(token), Date.now() - 86400e3).v; },
  firstPriceSince(token, t0) { const r = db.prepare("SELECT price FROM trades WHERE token = ? AND ts >= ? ORDER BY ts ASC LIMIT 1").get(lc(token), t0); return r ? r.price : null; },
  lastPriceBefore(token, t0) { const r = db.prepare("SELECT price FROM trades WHERE token = ? AND ts < ? ORDER BY ts DESC LIMIT 1").get(lc(token), t0); return r ? r.price : null; },
  totalCount() { return db.prepare("SELECT COUNT(*) AS n FROM trades").get().n; },
};
export const holdersRepo = {
  apply(token, addr, delta, ts) {
    token = lc(token); addr = lc(addr);
    const row = db.prepare("SELECT balance, since FROM holders WHERE token = ? AND addr = ?").get(token, addr);
    const bal = (row ? row.balance : 0) + delta;
    if (row) db.prepare("UPDATE holders SET balance = ?, since = ? WHERE token = ? AND addr = ?").run(bal, bal > 0 ? row.since : ts, token, addr);
    else db.prepare("INSERT INTO holders(token, addr, balance, since) VALUES (?, ?, ?, ?)").run(token, addr, bal, ts);
  },
  top(token, n = 50) { return db.prepare("SELECT addr, balance, since FROM holders WHERE token = ? AND balance > 1 ORDER BY balance DESC LIMIT ?").all(lc(token), n); },
  count(token) { return db.prepare("SELECT COUNT(*) AS n FROM holders WHERE token = ? AND balance > 1").get(lc(token)).n; },
  balance(token, addr) { const r = db.prepare("SELECT balance FROM holders WHERE token = ? AND addr = ?").get(lc(token), lc(addr)); return r ? r.balance : 0; },
};
export const agentTradesRepo = {
  insert(t) { db.prepare("INSERT INTO agent_trades(agentToken, at, type, token, ticker, eth, tokens, tx, ok, note) VALUES (@agentToken, @at, @type, @token, @ticker, @eth, @tokens, @tx, @ok, @note)").run({ tokens: 0, tx: null, ok: 1, note: "", ...t, agentToken: lc(t.agentToken), token: lc(t.token), ok: t.ok === false ? 0 : 1 }); },
  forAgent(token, n = 100) { return db.prepare("SELECT * FROM agent_trades WHERE agentToken = ? ORDER BY at DESC LIMIT ?").all(lc(token), n); },
  count() { return db.prepare("SELECT COUNT(*) AS n FROM agent_trades WHERE ok = 1 AND type IN ('buy','sell')").get().n; },
};
export const ledgerRepo = {
  add(token, eth) { db.prepare("INSERT INTO fee_ledger(token, owedEth) VALUES (?, ?) ON CONFLICT(token) DO UPDATE SET owedEth = owedEth + excluded.owedEth").run(lc(token), eth); },
  all() { return db.prepare("SELECT * FROM fee_ledger").all(); },
  get(token) { return db.prepare("SELECT * FROM fee_ledger WHERE token = ?").get(lc(token)) || { token: lc(token), owedEth: 0, paidEth: 0, lastPaidAt: 0 }; },
  pay(token, eth, at) { db.prepare("INSERT INTO fee_ledger(token, owedEth, paidEth, lastPaidAt) VALUES (?, 0, ?, ?) ON CONFLICT(token) DO UPDATE SET owedEth = max(0, owedEth - excluded.paidEth), paidEth = paidEth + excluded.paidEth, lastPaidAt = excluded.lastPaidAt").run(lc(token), eth, at); },
};
export const payoutsRepo = {
  insert(p) { db.prepare("INSERT INTO payouts(token, at, eth, reserveEth, usd, tx) VALUES (@token, @at, @eth, @reserveEth, @usd, @tx)").run({ tx: null, ...p, token: lc(p.token) }); },
  forToken(token) { return db.prepare("SELECT * FROM payouts WHERE token = ? ORDER BY at DESC LIMIT 50").all(lc(token)); },
  totalEth() { return db.prepare("SELECT COALESCE(SUM(eth + reserveEth), 0) AS e FROM payouts").get().e; },
};
export const tx = (fn) => { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };
