const { config } = require("./config.cjs");

const getExplorerLink = (chainId, hash) => {
  if (chainId === config.evm.chainId)
    return `https://sepolia.etherscan.io/tx/${hash}`;

  if (chainId === config.monad.chainId)
    return `https://testnet.monadexplorer.com/tx/${hash}`;

  if (chainId === config.starknet.chainId)
    return `https://sepolia.starkscan.co/tx/${hash}`;
};

module.exports = { getExplorerLink };
