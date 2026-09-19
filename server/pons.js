/* Pons V2 on Robinhood Chain — the ABI fragments PETRI calls and the curve's exact math.
   Layouts and selectors were verified on chain (fork + trace); the LaunchParams struct is shared by
   the factory and the launch forwarder, and its `creatorFeeRecipient` is where the fees go — the vault. */
import { ethers } from "ethers";

export const ZERO = "0x0000000000000000000000000000000000000000";
export const LAUNCH_PARAMS = "tuple(string name, string symbol, string logo, string description, tuple(string twitter, string telegram, string discord, string website, string farcaster) socials, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, bytes32 expectedEconomics, bytes32 salt)";

export const FACTORY_ABI = [
  `function launchToken(${LAUNCH_PARAMS} params, uint256 launchConfigId, address pairToken, address[] snipeTaxExemptions) payable returns (address token, address curve)`,
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
  "function launchFee() view returns (uint256)",
  "function launchEnabled() view returns (bool)",
  "function canLaunch(address launcher) view returns (bool)",
  "function feeEscrow() view returns (address)",
  "function maxCreatorTaxBps() view returns (uint256)",
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
];
export const FORWARDER_ABI = [
  `function launchAndBuy(${LAUNCH_PARAMS} params, uint256 launchConfigId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient, address[] snipeTaxExemptions) payable returns (address token, address curve, uint256 tokensOut)`,
];
export const CURVE_ABI = [
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256)",
  "function getReserves() view returns (uint256 quote, uint256 tokens)",
  "function realQuoteReserve() view returns (uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function deployer() view returns (address)",
  "function quoteFeeBalance() view returns (uint256)",
  "function launchSupply() view returns (uint256)",
  "event CurveBuy(address indexed sender, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 creatorTax)",
  "event CurveSell(address indexed sender, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 creatorTax)",
];
export const ESCROW_ABI = ["function balanceOf(address) view returns (uint256)", "function claim()"];
export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)", "function allowance(address, address) view returns (uint256)", "function approve(address, uint256) returns (bool)", "function transfer(address, uint256) returns (bool)",
  "function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];
export const MOCK_CURVE_ABI = [...CURVE_ABI, "function sweep()"];

export const iface = {
  factory: new ethers.Interface(FACTORY_ABI),
  forwarder: new ethers.Interface(FORWARDER_ABI),
  curve: new ethers.Interface(CURVE_ABI),
  erc20: new ethers.Interface(ERC20_ABI),
};
export const TOPICS = {
  buy: iface.curve.getEvent("CurveBuy").topicHash,
  sell: iface.curve.getEvent("CurveSell").topicHash,
  transfer: iface.erc20.getEvent("Transfer").topicHash,
  launched: iface.factory.getEvent("TokenLaunched").topicHash,
};

export const BPS = 10_000n;
export const SUPPLY = 10n ** 27n; // 1e9 tokens × 1e18
/* tokens out for `amountIn`, after `takenBps` (curve fee + creator tax) leaves the input */
export function quoteBuy(quote, tokens, amountIn, takenBps) {
  if (amountIn <= 0n || quote <= 0n || tokens <= 0n || takenBps >= BPS) return 0n;
  const net = amountIn - (amountIn * takenBps) / BPS;
  return (tokens * net) / (quote + net);
}
/* quote out for `tokensIn`, after `takenBps` leaves the output */
export function quoteSell(quote, tokens, tokensIn, takenBps) {
  if (tokensIn <= 0n || quote <= 0n || tokens <= 0n || takenBps >= BPS) return 0n;
  const gross = (quote * tokensIn) / (tokens + tokensIn);
  return gross - (gross * takenBps) / BPS;
}
export const withSlippage = (out, bps) => (out * (BPS - BigInt(bps))) / BPS;
/* spot price in quote per whole token (float) and market cap in quote (float) */
export function spot(quote, tokens) { return tokens === 0n ? 0 : Number(quote) / Number(tokens); }
export function marketCap(quote, tokens) { return tokens === 0n ? 0 : (Number(quote) / 1e18) * (Number(SUPPLY) / Number(tokens)); }
