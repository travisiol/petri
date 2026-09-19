/** Local rehearsal network. `FORK_URL=https://rpc.mainnet.chain.robinhood.com` forks Robinhood Chain (real Pons). */
const FORK_URL = process.env.FORK_URL;
module.exports = {
  solidity: { version: "0.8.28", settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: {
    hardhat: {
      chainId: Number(process.env.HARDHAT_CHAIN_ID || 4663),
      mining: { auto: true, interval: 0 },
      // INITIAL_DATE lets a rehearsal start an hour in the past so seeded trades spread over a real-looking chart
      ...(process.env.INITIAL_DATE ? { initialDate: process.env.INITIAL_DATE } : {}),
      ...(FORK_URL ? { forking: { url: FORK_URL } } : {}),
    },
  },
};
