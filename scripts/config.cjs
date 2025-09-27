const dotenv = require("dotenv");
dotenv.config();

const config = {
  evm: {
    chainId: 11155111,
    rpcUrl: process.env.SEPOLIA_RPC,
    limitOrderProtocol: "0x111111125421cA6dc452d289314280a0f8842A65",
    escrowFactory: "0x09092Cde983b41F6C5cB945c02bb102ABEFfA6CB",
    resolverContract: "0xB4Dd500EC6725494872550649b75C70EA4b0D093",
    wrapped: "0x7b79995e5f793a07bc00c21412e50ecae098e7f9",
    explorerUrl: "https://sepolia.etherscan.io",
    resolverPrivateKey: process.env.ETH_RESOLVER_PRIVATE_KEY,
    userPrivateKey: process.env.ETH_USER_PRIVATE_KEY,
  },
  monad: {
    chainId: 10143,
    rpcUrl: "https://testnet-rpc.monad.xyz",
    limitOrderProtocol: "0x09092Cde983b41F6C5cB945c02bb102ABEFfA6CB",
    escrowFactory: "0xB4Dd500EC6725494872550649b75C70EA4b0D093",
    resolverContract: "0x83E73B06DFcf69537469877D827Ddb1fB0C99545",
    wrapped: "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701",
    explorerUrl: "https://testnet.monadexplorer.com",
    resolverPrivateKey: process.env.ETH_RESOLVER_PRIVATE_KEY,
    userPrivateKey: process.env.ETH_USER_PRIVATE_KEY,
  },
  starknet: {
    chainId: 1,
    rpcUrl: "https://starknet-sepolia.public.blastapi.io",
    htlcContract:
      "0x5fc3c3dc566451a11667bf278d7935338191072108abf5e9e611cf04e122a23",
    explorerUrl: "https://sepolia.starkscan.co",
    token: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d", // STRK
    eventKey:
      "0xfdec90ee43c121802922d166daad5eb9c3c9f5bbdd49e568ed0dc5c3284129",
    resolverPrivateKey: process.env.STARKNET_RESOLVER_PRIVATE_KEY,
    resolverAddress: process.env.STARKNET_RESOLVER_ADDRESS,
    userPrivateKey: process.env.STARKNET_USER_PRIVATE_KEY,
    userAddress: process.env.STARKNET_USER_ADDRESS,
  },
};

module.exports = { config };
