/* ETH/USD without a key: Coinbase spot first, Yahoo's chart API as the fallback (needs a User-Agent).
   Cached for a minute; the last good price survives outages so nothing on the site goes to $0. */
let cache = { usd: 0, at: 0 };
const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/ETH-USD?range=1d&interval=5m";
export async function ethUsd() {
  if (Date.now() - cache.at < 60e3 && cache.usd > 0) return cache.usd;
  const usd = (await coinbase().catch(() => 0)) || (await yahoo().catch(() => 0));
  if (usd > 0) cache = { usd, at: Date.now() };
  else if (!cache.usd) cache = { usd: Number(process.env.ETH_USD_FALLBACK || 0) || 2600, at: Date.now() - 50e3 };
  return cache.usd;
}
export const ethUsdCached = () => cache.usd || 0;
async function coinbase() {
  const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { signal: AbortSignal.timeout(6000) });
  const j = await r.json(); return Number(j && j.data && j.data.amount) || 0;
}
async function yahoo() {
  const r = await fetch(YAHOO, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(6000) });
  const j = await r.json(); return Number(j && j.chart && j.chart.result && j.chart.result[0].meta.regularMarketPrice) || 0;
}
