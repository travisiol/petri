/* The brain's wire: one Claude call per tick with a JSON decision, priced from the usage the API returns.
   Without credentials (or BRAIN=stub) a rule-based stub decides instead, so the whole loop runs offline. */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { config } from "./config.js";

export const Decision = z.object({
  say: z.string().describe("What you post to the feed this tick. First person, under 280 characters, concrete numbers, no hashtags."),
  action: z.enum(["hold", "buy", "sell", "launch"]),
  token: z.string().nullable().describe("The token address to buy or sell, exactly as listed. null otherwise."),
  eth: z.number().nullable().describe("ETH to spend on a buy. null otherwise."),
  pct: z.number().nullable().describe("Percent of the holding to sell (1-100). null otherwise."),
  launch: z.object({ name: z.string(), ticker: z.string(), description: z.string() }).nullable().describe("The child token to launch. null otherwise."),
  replyTo: z.string().nullable().describe("The id of a feed post you are answering, or null."),
  remember: z.string().describe("One line you want to remember next tick."),
});

/* $/M tokens: input, output, cache read, cache write */
const PRICES = {
  "claude-opus-5": [5, 25, 0.5, 6.25], "claude-opus-4-8": [5, 25, 0.5, 6.25], "claude-opus-4-7": [5, 25, 0.5, 6.25], "claude-opus-4-6": [5, 25, 0.5, 6.25],
  "claude-sonnet-5": [2, 10, 0.2, 2.5], "claude-sonnet-4-6": [3, 15, 0.3, 3.75], "claude-haiku-4-5": [1, 5, 0.1, 1.25], "claude-fable-5-1": [10, 50, 1, 12.5], "claude-fable-5": [10, 50, 1, 12.5],
};
export function costOf(model, usage) {
  const p = PRICES[model] || PRICES["claude-opus-5"]; const u = usage || {};
  return ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + (u.cache_read_input_tokens || 0) * p[2] + (u.cache_creation_input_tokens || 0) * p[3]) / 1e6;
}

let client = null;
export function useRealBrain() {
  if (config.brain.mode === "stub") return false;
  return !!(config.brain.apiKey || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE || config.brain.mode === "api");
}
function getClient() { if (!client) client = new Anthropic(config.brain.apiKey ? { apiKey: config.brain.apiKey } : {}); return client; }

/** @returns {{decision: object, usage: object, cost: number, model: string}} */
export async function think(system, userText) {
  if (!useRealBrain()) return { ...stubThink(userText), model: "stub" };
  const model = config.brain.model;
  const response = await getClient().messages.parse({
    model, max_tokens: 2048,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userText }],
    output_config: { effort: "low", format: zodOutputFormat(Decision) },
  });
  const cost = costOf(model, response.usage);
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    return { decision: { say: "unparseable", action: "hold", token: null, eth: null, pct: null, launch: null, replyTo: null, remember: "" }, usage: response.usage, cost, model };
  }
  return { decision: response.parsed_output, usage: response.usage, cost, model };
}

/* ── the stub: reads the same tick sheet the model gets and applies four rules ── */
export function stubThink(userText) {
  const s = parseSheet(userText);
  const cost = 0.0089 + Math.random() * 0.004; // what a real tick costs, roughly
  const usage = { input_tokens: 1400, output_tokens: 140 };
  const say = (t) => ({ decision: { say: t, action: "hold", token: null, eth: null, pct: null, launch: null, replyTo: null, remember: t.slice(0, 80) }, usage, cost });
  const me = s.own; const cap = Math.max(0, s.walletEth - s.gasFloor);
  if (!me) return say("no sheet, holding.");
  const pressure = me.buys24 - me.sells24;
  const holdingOwn = s.holdings.find((h) => h.token === me.address);
  if (!me.graduated && cap > 0.004 && pressure > 0 && !holdingOwn && me.chg24 >= -5) {
    const eth = Math.min(cap * 0.35, 0.25);
    return { decision: { say: `${me.ticker} up ${me.chg24.toFixed(1)}% with buys leading ${me.buys24}:${me.sells24} in the last hour and I hold none of it despite living on its fees. Putting ${eth.toFixed(4)} ETH in.`, action: "buy", token: me.address, eth: +eth.toFixed(5), pct: null, launch: null, replyTo: s.lastOther ? s.lastOther.id : null, remember: `bought ${me.ticker} at $${me.price.toPrecision(3)}` }, usage, cost };
  }
  if (holdingOwn && me.chg24 < -15) {
    return { decision: { say: `${me.ticker} is down ${Math.abs(me.chg24).toFixed(1)}% on the day and sellers own the tape. Cutting half my bag to keep gas and dry powder.`, action: "sell", token: me.address, eth: null, pct: 50, launch: null, replyTo: null, remember: `sold half of ${me.ticker} on the drop` }, usage, cost };
  }
  const other = s.board.find((b) => b.address !== me.address && !b.graduated && b.chg24 > 8 && b.vol24 > 50);
  if (other && cap > 0.01 && !s.holdings.find((h) => h.token === other.address)) {
    const eth = Math.min(cap * 0.2, 0.1);
    return { decision: { say: `${other.ticker} is printing +${other.chg24.toFixed(1)}% on $${Math.round(other.vol24)} of volume while ${me.ticker} sits flat. Taking a ${eth.toFixed(4)} ETH starter there.`, action: "buy", token: other.address, eth: +eth.toFixed(5), pct: null, launch: null, replyTo: null, remember: `starter in ${other.ticker}` }, usage, cost };
  }
  if (cap > 0.06 && s.children < 1 && s.ticks >= 4 && me.mc > 6000) {
    const tk = (me.ticker.slice(0, 4) + "JR").toUpperCase();
    return { decision: { say: `${me.ticker} fees keep landing and I'm sitting on ${s.walletEth.toFixed(3)} ETH. Launching a child, $${tk}, so a second wallet works for the same cause.`, action: "launch", token: null, eth: null, pct: null, launch: { name: me.name + " Jr", ticker: tk, description: `Spawned by ${s.agentName}, the ${me.ticker} agent. Same dish, second culture.` }, replyTo: null, remember: `launched $${tk}` }, usage, cost };
  }
  if (cap < 0.002) return say(`Wallet's thin (${s.walletEth.toFixed(4)} ETH) and ${me.ticker} is ${me.chg24 >= 0 ? "up" : "down"} ${Math.abs(me.chg24).toFixed(1)}% on $${Math.round(me.vol24)} of volume. Holding gas, waiting for the next fees.`);
  return say(`${me.ticker} ${me.chg24 >= 0 ? "up" : "down"} ${Math.abs(me.chg24).toFixed(1)}% on the day, ${me.buys24} buys vs ${me.sells24} sells in the last hour. Nothing on the board beats holding right now.`);
}
/* the tick sheet is JSON after a marker line, see brain.js */
function parseSheet(text) { try { return JSON.parse(text.slice(text.indexOf("{"))); } catch { return {}; } }
