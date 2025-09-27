const {
  JsonRpcProvider,
  parseUnits,
  formatUnits,
  Wallet,
  ZeroAddress,
  Contract,
  MaxUint256,
  parseEther,
  ethers,
} = require("ethers");
const Sdk = require("@1inch/cross-chain-sdk");
const inquirer = require("inquirer");
const { config } = require("./config.cjs");
const { uint8ArrayToHex, UINT_40_MAX } = require("@1inch/byte-utils");
const { randomBytes } = require("crypto");
const { readFileSync } = require("fs");
const { EVMEscrowFactory, EVMResolver } = require("./evm/evm.cjs");
const { setDeployedAt, getOrderHash } = require("./evm/utils.cjs");
const { StarknetHTLC } = require("./starknet/starknet.cjs");
const { getExplorerLink } = require("./utils.cjs");
const {
  hash,
  Contract: StarknetContract,
  cairo,
  Account,
  RpcProvider,
} = require("starknet");

const evmProvider = new JsonRpcProvider(config.evm.rpcUrl);
const evmUserWallet = new Wallet(config.evm.userPrivateKey, evmProvider);
const evmResolverWallet = new Wallet(
  config.evm.resolverPrivateKey,
  evmProvider
);

const monadProvider = new JsonRpcProvider(config.monad.rpcUrl);
const monadUserWallet = new Wallet(config.monad.userPrivateKey, monadProvider);
const monadResolverWallet = new Wallet(
  config.monad.resolverPrivateKey,
  monadProvider
);

const starknetProvider = new RpcProvider({
  nodeUrl: config.starknet.rpcUrl,
});
const starknetUserWallet = new Account(
  starknetProvider,
  config.starknet.userAddress,
  config.starknet.userPrivateKey
);

const TOKENS = {
  monad: {
    FUSION: {
      address: "0x177e7d21f3546c2ba14740a61259963DC6E78999",
      decimals: 18,
      symbol: "FUSION",
    },
  },
  evm: {
    FUSION: {
      address: "0xc508006c1872Cf6B0A5c00791F7A96f3e130D408",
      decimals: 18,
      symbol: "FUSION",
    },
  },
  starknet: {
    STRK: {
      address: config.starknet.token,
      decimals: 18,
      symbol: "STRK",
    },
  },
};

class CrossChainSwapManager {
  constructor() {
    this.evmResolver = null;
    this.evmEscrowFactory = null;
    this.monadResolver = null;
    this.monadEscrowFactory = null;
    this.starknetHTLC = null;
  }

  initialize() {
    this.initializeEvmContracts();
    this.initializeStarknetContracts();

    const abi = JSON.parse(readFileSync("./abis/erc20.json", "utf8"));
    this.erc20Abi = abi.abi;
  }

  initializeEvmContracts() {
    this.evmEscrowFactory = new EVMEscrowFactory(
      evmProvider,
      config.evm.escrowFactory
    );
    this.evmResolver = new EVMResolver(
      config.evm.resolverContract,
      config.evm.limitOrderProtocol
    );

    this.monadEscrowFactory = new EVMEscrowFactory(
      monadProvider,
      config.monad.escrowFactory
    );
    this.monadResolver = new EVMResolver(
      config.monad.resolverContract,
      config.monad.limitOrderProtocol
    );
  }

  initializeStarknetContracts() {
    this.starknetHTLC = new StarknetHTLC();
  }

  async selectDirection() {
    const { direction } = await inquirer.prompt([
      {
        type: "list",
        name: "direction",
        message: "Select swap direction:",
        choices: [
          { name: "EVM → Starknet", value: "evm-to-starknet" },
          { name: "Starknet → EVM", value: "starknet-to-evm" },
          { name: "Sepolia → Monad", value: "evm-to-monad" },
          { name: "Monad → Sepolia", value: "monad-to-evm" },
        ],
      },
    ]);
    return direction;
  }

  async selectToken(chain, message) {
    const tokens = TOKENS[chain];
    const choices = Object.keys(tokens).map((key) => ({
      name: `${tokens[key].symbol}`,
      value: key,
    }));

    const { selectedToken } = await inquirer.prompt([
      {
        type: "list",
        name: "selectedToken",
        message: message,
        choices: choices,
      },
    ]);

    return tokens[selectedToken];
  }

  async getAmount(token, message) {
    const { amount } = await inquirer.prompt([
      {
        type: "input",
        name: "amount",
        message: `${message} (${token.symbol})`,
        validate: (input) => {
          const num = parseFloat(input);
          if (isNaN(num) || num <= 0) {
            return "Please enter a valid positive number";
          }
          return true;
        },
      },
    ]);

    return parseUnits(amount, token.decimals);
  }

  async confirmTransaction(order, srcToken, dstToken, direction) {
    console.log("\n=== ORDER SUMMARY ===");
    console.log(`Direction: ${direction}`);
    console.log(`Source Token: ${srcToken.symbol}`);
    console.log(`Destination Token: ${dstToken.symbol}`);
    console.log(
      `Making Amount: ${formatUnits(order.makingAmount, srcToken.decimals)} ${
        srcToken.symbol
      }`
    );
    console.log(
      `Taking Amount: ${formatUnits(order.takingAmount, dstToken.decimals)} ${
        dstToken.symbol
      }`
    );
    console.log(
      `Source Safety Deposit: ${formatUnits(
        order.escrowExtension.srcSafetyDeposit,
        18
      )}`
    );
    console.log(
      `Destination Safety Deposit: ${formatUnits(
        order.escrowExtension.dstSafetyDeposit,
        18
      )}`
    );
    console.log("=====================\n");

    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: "Do you want to proceed with this transaction?",
        default: false,
      },
    ]);

    return confirm;
  }

  createOrder(
    srcChain,
    dstChain,
    srcTokenAddress,
    dstTokenAddress,
    makingAmount,
    takingAmount,
    userAddress,
    receiver = ZeroAddress
  ) {
    const isSrcOrDstStarknet =
      srcChain.chainId === config.starknet.chainId ||
      dstChain.chainId === config.starknet.chainId;

    const secret = uint8ArrayToHex(randomBytes(isSrcOrDstStarknet ? 31 : 32));
    const srcTimestamp = BigInt(Math.floor(Date.now() / 1000));

    const order = Sdk.EvmCrossChainOrder.new(
      new Sdk.EvmAddress(
        new Sdk.Address(
          srcChain.chainId === config.starknet.chainId
            ? ZeroAddress
            : srcChain.escrowFactory
        )
      ),
      {
        salt: Sdk.randBigInt(1000n),
        maker: new Sdk.EvmAddress(new Sdk.Address(userAddress)),
        makingAmount: makingAmount,
        takingAmount: takingAmount,
        makerAsset: new Sdk.EvmAddress(
          new Sdk.Address(
            srcChain.chainId === config.starknet.chainId
              ? ZeroAddress
              : srcTokenAddress
          )
        ),
        takerAsset: new Sdk.EvmAddress(
          new Sdk.Address(
            dstChain.chainId === config.starknet.chainId
              ? ZeroAddress
              : dstTokenAddress
          )
        ),
        receiver: new Sdk.EvmAddress(new Sdk.Address(receiver)),
      },
      {
        hashLock: Sdk.HashLock.forSingleFill(
          isSrcOrDstStarknet ? secret + "00" : secret
        ),
        timeLocks: Sdk.TimeLocks.new({
          srcWithdrawal: 1n,
          srcPublicWithdrawal: 1200n,
          srcCancellation: 1210n,
          srcPublicCancellation: 1220n,
          dstWithdrawal: 1n,
          dstPublicWithdrawal: 1000n,
          dstCancellation: 1010n,
        }),
        srcChainId: 1,
        dstChainId: 137,
        srcSafetyDeposit: parseEther("0.000001"),
        dstSafetyDeposit: parseEther("0.000001"),
      },
      {
        auction: new Sdk.AuctionDetails({
          initialRateBump: 0,
          points: [],
          duration: 120n,
          startTime: srcTimestamp,
        }),
        whitelist: [
          {
            address: new Sdk.EvmAddress(
              new Sdk.Address(
                srcChain.chainId === config.starknet.chainId
                  ? ZeroAddress
                  : srcChain.resolverContract
              )
            ),
            allowFrom: 0n,
          },
        ],
        resolvingStartTime: 0n,
      },
      {
        nonce: Sdk.randBigInt(UINT_40_MAX),
        allowPartialFills: false,
        allowMultipleFills: false,
      }
    );

    order.inner.fusionExtension.srcChainId = srcChain.chainId;
    order.inner.fusionExtension.dstChainId = dstChain.chainId;

    console.log("Order details:", order.toJSON());

    return { order, secret };
  }

  createStarknetToEVMOrder(dstTokenAddress, makingAmount, takingAmount) {
    const secret = uint8ArrayToHex(randomBytes(31));

    const order = Sdk.EvmCrossChainOrder.new(
      new Sdk.EvmAddress(new Sdk.Address(ZeroAddress)),
      {
        salt: Sdk.randBigInt(1000n),
        maker: new Sdk.EvmAddress(new Sdk.Address(ZeroAddress)),
        makerAsset: new Sdk.EvmAddress(new Sdk.Address(ZeroAddress)),
        makingAmount: makingAmount,
        takingAmount: takingAmount,
        takerAsset: new Sdk.EvmAddress(new Sdk.Address(dstTokenAddress)),
        receiver: new Sdk.EvmAddress(new Sdk.Address(evmUserWallet.address)),
      },
      {
        hashLock: Sdk.HashLock.forSingleFill(secret + "00"),
        timeLocks: Sdk.TimeLocks.new({
          srcWithdrawal: 1n,
          srcPublicWithdrawal: 1643n,
          srcCancellation: 1644n,
          srcPublicCancellation: 1825n,
          dstWithdrawal: 1n,
          dstPublicWithdrawal: 1511n,
          dstCancellation: 1512n,
        }),
        srcChainId: 1,
        dstChainId: 137,
        srcSafetyDeposit: parseEther("0.000001"),
        dstSafetyDeposit: parseEther("0.000001"),
      },
      {
        auction: new Sdk.AuctionDetails({
          initialRateBump: 0,
          points: [],
          duration: 120n,
          startTime: BigInt(Math.floor(Date.now() / 1000)),
        }),
        whitelist: [
          {
            address: new Sdk.EvmAddress(new Sdk.Address(ZeroAddress)),
            allowFrom: 0n,
          },
        ],
        resolvingStartTime: 0n,
      },
      {
        nonce: Sdk.randBigInt(UINT_40_MAX),
        allowPartialFills: false,
        allowMultipleFills: false,
      }
    );

    order.inner.fusionExtension.srcChainId = config.starknet.chainId;
    order.inner.fusionExtension.dstChainId = config.evm.chainId;

    console.log("Order details:", order.toJSON());

    return { order, secret };
  }

  async checkEVMAllowance(token, amount, userWallet) {
    console.log("Checking allowance...");
    const tokenContract = new Contract(
      token.address,
      this.erc20Abi,
      userWallet
    );

    const allowance = await tokenContract.allowance(
      await userWallet.getAddress(),
      config.evm.limitOrderProtocol
    );
    console.log("Current allowance:", allowance.toString());

    if (allowance < amount) {
      console.log("⚠️  Warning: Insufficient allowance");
      console.log("Approving tokens...");
      const txData = tokenContract.interface.encodeFunctionData("approve", [
        config.evm.limitOrderProtocol,
        MaxUint256,
      ]);
      const fillTx = await userWallet.sendTransaction({
        to: token.address,
        data: txData,
      });
      console.log(`✅ Token approval successful`);
      console.log(
        `Transaction hash: ${getExplorerLink(config.evm.chainId, fillTx.hash)}`
      );
    }
  }

  async checkMonadAllowance(token, amount, userWallet) {
    console.log("Checking allowance...");
    const tokenContract = new Contract(
      token.address,
      this.erc20Abi,
      monadProvider
    );

    const allowance = await tokenContract.allowance(
      await userWallet.getAddress(),
      config.monad.limitOrderProtocol
    );
    console.log("Current allowance:", allowance.toString());

    if (allowance < amount) {
      console.log("⚠️  Warning: Insufficient allowance");
      console.log("Approving tokens...");
      const txData = tokenContract.interface.encodeFunctionData("approve", [
        config.monad.limitOrderProtocol,
        MaxUint256,
      ]);
      const fillTx = await userWallet.sendTransaction({
        to: token.address,
        data: txData,
      });
      console.log(`✅ Token approval successful`);
      console.log(
        `Transaction hash: ${getExplorerLink(
          config.monad.chainId,
          fillTx.hash
        )}`
      );
    }
  }

  async checkStarknetAllowance(token, amount, spender) {
    console.log(`Checking Starknet allowance for ${token.symbol}...`);

    const { abi } = await starknetProvider.getClassAt(token.address);
    const tokenContract = new StarknetContract(
      abi,
      token.address,
      starknetUserWallet
    );
    const allowance = await tokenContract.allowance(
      starknetUserWallet.address,
      spender
    );

    console.log("Current allowance:", allowance);

    if (allowance < amount) {
      const allowanceAmount = cairo.uint256(100000n * 10n ** 18n);
      const approveTx = await tokenContract.approve(spender, allowanceAmount);
      await starknetProvider.waitForTransaction(approveTx.transaction_hash);

      console.log(`✅ Token approval successful!`);
      console.log(
        `Transaction hash: ${getExplorerLink(
          config.starknet.chainId,
          approveTx.transaction_hash
        )}`
      );
    }
  }

  async executeEvmToStarknetSwap() {
    console.log("\n🔄 Executing EVM → Starknet Swap");
    const srcToken = await this.selectToken(
      "evm",
      "Select source token (EVM):"
    );
    const dstToken = await this.selectToken(
      "starknet",
      "Select destination token (Starknet):"
    );

    const makingAmount = await this.getAmount(srcToken, "Enter making amount");
    const takingAmount = await this.getAmount(dstToken, "Enter taking amount");

    const userAddress = await evmUserWallet.getAddress();
    await this.checkEVMAllowance(srcToken, makingAmount, evmUserWallet);

    const { order, secret } = this.createOrder(
      config.evm,
      config.starknet,
      srcToken.address,
      ZeroAddress,
      makingAmount,
      takingAmount,
      userAddress
    );

    const confirmed = await this.confirmTransaction(
      order,
      srcToken,
      dstToken,
      "EVM → Starknet"
    );
    if (!confirmed) {
      console.log("❌ Transaction cancelled");
      return;
    }

    try {
      console.log("\n📝 Signing order...");
      const typedData = order.getTypedData(config.evm.chainId);
      const { domain, types, message } = typedData;

      const cleanTypes = { ...types };
      delete cleanTypes.EIP712Domain;

      const signature = await evmUserWallet.signTypedData(
        {
          ...domain,
          verifyingContract: config.evm.limitOrderProtocol,
        },
        cleanTypes,
        message
      );

      console.log("Signature:", signature);

      console.log("\n🔄 Preparing fill order on EVM...");
      const takerTraits = Sdk.TakerTraits.default()
        .setExtension(order.extension)
        .setAmountMode(Sdk.AmountMode.maker)
        .setAmountThreshold(order.takingAmount);

      const deployTx = this.evmResolver.deploySrc(
        config.evm.chainId,
        order,
        signature,
        takerTraits,
        makingAmount
      );
      console.log("\n🚀 Sending transaction...");
      const fillTx = await evmResolverWallet.sendTransaction(deployTx);
      console.log(
        `✅ EVM fill transaction: ${getExplorerLink(
          config.evm.chainId,
          fillTx.hash
        )}`
      );
      const receipt = await fillTx.wait(1);

      const srcEscrowEvent = await this.evmEscrowFactory.getSrcDeployEvent(
        fillTx.hash,
        receipt.blockHash
      );

      const immutablesResult = srcEscrowEvent[0];
      const ESCROW_SRC_IMPLEMENTATION =
        await this.evmEscrowFactory.getSourceImpl();

      const srcEscrowAddress = this.calculateEvmEscrowAddress(
        true,
        immutablesResult,
        ESCROW_SRC_IMPLEMENTATION
      );
      console.log("✅ EVM source escrow address:", srcEscrowAddress.toString());

      console.log("\n🏗️ Deploying destination escrow on Starknet...");
      const dstImmutables = {
        order_hash: order.getOrderHash(config.evm.chainId).toString(16),
        hash_lock: hash.computePoseidonHashOnElements([secret]),
        maker: config.starknet.resolverAddress,
        taker: config.starknet.userAddress,
        token: config.starknet.token,
        amount: takingAmount,
        safety_deposit: parseEther("0.000001"),
        timelocks: {
          deployed_at: 0,
          src_withdrawal: 1,
          src_public_withdrawal: 1200,
          src_cancellation: 1201,
          src_public_cancellation: 1250,
          dst_withdrawal: 1,
          dst_public_withdrawal: 1100,
          dst_cancellation: 1101,
        },
      };
      const deployment = await this.starknetHTLC.deployDst(dstImmutables);
      console.log(
        `✅ Starknet fill transaction: ${getExplorerLink(
          config.starknet.chainId,
          deployment.txHash
        )}`
      );

      console.log(
        "✅ Starknet destination escrow address:",
        deployment.dstEscrowId
      );

      console.log("\n💸 Withdrawing from Starknet escrow...");
      const starknetWithdrawTx = await this.starknetHTLC.withdraw(
        deployment.dstEscrowId,
        secret
      );
      console.log(
        `✅ Starknet withdrawal transaction: ${getExplorerLink(
          config.starknet.chainId,
          starknetWithdrawTx.txHash
        )}`
      );

      console.log("\n💸 Withdrawing from EVM escrow...");
      const withdrawTx = this.evmResolver.withdraw(
        srcEscrowAddress,
        secret + "00",
        immutablesResult
      );

      const srcWithdrawTx = await evmResolverWallet.sendTransaction(withdrawTx);
      await srcWithdrawTx.wait();

      console.log(
        `✅ EVM withdrawal transaction: ${getExplorerLink(
          config.evm.chainId,
          srcWithdrawTx.hash
        )}`
      );
      console.log("\n🎉 EVM → Starknet swap completed successfully!");
    } catch (error) {
      console.error("❌ Error during EVM → Starknet swap:", error.message);
      throw error;
    }
  }

  async executeStarknetToEvmSwap() {
    console.log("\n🔄 Executing Starknet → EVM Swap");

    const srcToken = await this.selectToken(
      "starknet",
      "Select source token (Starknet):"
    );
    const dstToken = await this.selectToken(
      "evm",
      "Select destination token (EVM):"
    );

    const makingAmount = await this.getAmount(srcToken, "Enter making amount");
    const takingAmount = await this.getAmount(dstToken, "Enter taking amount");

    const { order, secret } = this.createStarknetToEVMOrder(
      dstToken.address,
      makingAmount,
      takingAmount
    );

    const confirmed = await this.confirmTransaction(
      order,
      srcToken,
      dstToken,
      "Starknet → EVM"
    );
    if (!confirmed) {
      console.log("❌ Transaction cancelled");
      return;
    }

    try {
      await this.checkStarknetAllowance(
        srcToken,
        makingAmount,
        config.starknet.htlcContract
      );

      console.log("\n Deploying source escrow on Starknet...");
      const fillTx = await this.starknetHTLC.deploySrc(
        config.starknet.userAddress,
        order,
        hash.computePoseidonHashOnElements([secret])
      );
      console.log(
        `✅ Starknet fill transaction: ${getExplorerLink(
          config.starknet.chainId,
          fillTx.txHash
        )}`
      );
      console.log("✅ Starknet source escrow address:", fillTx.escrowId);

      console.log("\n🏗️ Deploying destination escrow on EVM...");
      const timeLocksWithDeployment = Sdk.TimeLocks.fromBigInt(
        setDeployedAt(
          order.inner.fusionExtension.timeLocks.build(),
          BigInt(fillTx.blockTimestamp)
        )
      );

      const orderHash = getOrderHash(config.evm.chainId, order, {
        verifyingContract: ZeroAddress,
      });

      const srcImmutables = Sdk.Immutables.new({
        orderHash: Buffer.from(ethers.hexlify(orderHash).slice(2), "hex"),
        hashLock: order.inner.fusionExtension.hashLockInfo,
        maker: order.maker,
        taker: new Sdk.EvmAddress(new Sdk.Address(ZeroAddress)),
        token: order.makerAsset,
        amount: order.makingAmount,
        safetyDeposit: order.inner.fusionExtension.srcSafetyDeposit,
        timeLocks: timeLocksWithDeployment,
      });

      const complement = Sdk.DstImmutablesComplement.new({
        maker: new Sdk.EvmAddress(new Sdk.Address(evmUserWallet.address)),
        taker: order.receiver,
        token: new Sdk.EvmAddress(new Sdk.Address(dstToken.address)),
        amount: order.takingAmount,
        safetyDeposit: order.inner.fusionExtension.dstSafetyDeposit,
      });

      const dstImmutables = srcImmutables
        .withComplement(complement)
        .withTaker(
          new Sdk.EvmAddress(new Sdk.Address(config.evm.resolverContract))
        );

      const deployTx = this.evmResolver.deployDst(dstImmutables);

      const dstTx = await evmResolverWallet.sendTransaction(deployTx);
      const receipt = await dstTx.wait();

      console.log(
        `✅ EVM destination fill transaction: ${getExplorerLink(
          config.evm.chainId,
          dstTx.hash
        )}`
      );

      const ESCROW_DST_IMPLEMENTATION =
        await this.evmEscrowFactory.getDestinationImpl();

      const dstDeployedAt = BigInt((await receipt.getBlock()).timestamp);
      const dstEscrowAddress = this.calculateEvmEscrowAddress(
        false,
        srcImmutables,
        ESCROW_DST_IMPLEMENTATION,
        complement,
        dstDeployedAt
      );
      console.log(
        "✅ EVM destination escrow address:",
        dstEscrowAddress.toString()
      );

      const withdrawTx = this.evmResolver.withdraw(
        dstEscrowAddress,
        secret + "00",
        dstImmutables.withDeployedAt(dstDeployedAt)
      );

      console.log("\n💸 Withdrawing from EVM escrow...");
      const dstWithdrawTx = await evmResolverWallet.sendTransaction(withdrawTx);
      await dstWithdrawTx.wait();

      console.log(
        `✅ EVM withdrawal transaction: ${getExplorerLink(
          config.evm.chainId,
          dstWithdrawTx.hash
        )}`
      );

      console.log("\n💸 Withdrawing from Starknet escrow...");
      const txInfo = await this.starknetHTLC.withdraw(fillTx.escrowId, secret);
      console.log(
        `✅ Starknet withdrawal transaction: ${getExplorerLink(
          config.starknet.chainId,
          txInfo.txHash
        )}`
      );
      console.log("\n🎉 Starknet → EVM swap completed successfully!");
    } catch (error) {
      console.error("❌ Error during Starknet → EVM swap:", error.message);
    }
  }

  async executeEvmToMonadSwap() {
    console.log("\n🔄 Executing Sepolia → Monad Swap");
    const srcToken = await this.selectToken(
      "evm",
      "Select source token (Sepolia):"
    );
    const dstToken = await this.selectToken(
      "monad",
      "Select destination token (Monad):"
    );

    const makingAmount = await this.getAmount(srcToken, "Enter making amount");
    const takingAmount = await this.getAmount(dstToken, "Enter taking amount");

    const userAddress = await evmUserWallet.getAddress();
    await this.checkEVMAllowance(srcToken, makingAmount, evmUserWallet);

    const { order, secret } = this.createOrder(
      config.evm,
      config.monad,
      srcToken.address,
      dstToken.address,
      makingAmount,
      takingAmount,
      userAddress
    );

    const confirmed = await this.confirmTransaction(
      order,
      srcToken,
      dstToken,
      "Sepolia → Monad"
    );
    if (!confirmed) {
      console.log("❌ Transaction cancelled");
      return;
    }

    try {
      console.log("\n📝 Signing order...");
      const typedData = order.getTypedData(config.evm.chainId);
      const { domain, types, message } = typedData;

      const cleanTypes = { ...types };
      delete cleanTypes.EIP712Domain;

      const signature = await evmUserWallet.signTypedData(
        {
          ...domain,
          verifyingContract: config.evm.limitOrderProtocol,
        },
        cleanTypes,
        message
      );

      console.log("Signature:", signature);

      console.log("\n🔄 Preparing fill order on Sepolia...");

      const deployTx = this.evmResolver.deploySrc(
        config.evm.chainId,
        order,
        signature,
        Sdk.TakerTraits.default()
          .setExtension(order.extension)
          .setAmountMode(Sdk.AmountMode.maker)
          .setAmountThreshold(order.takingAmount),
        makingAmount
      );

      console.log("\n🚀 Sending transaction...");
      const fillTx = await evmResolverWallet.sendTransaction(deployTx);
      console.log(
        `✅ Sepolia fill transaction: ${getExplorerLink(
          config.evm.chainId,
          fillTx.hash
        )}`
      );
      const receipt = await fillTx.wait(1);

      const srcEscrowEvent = await this.evmEscrowFactory.getSrcDeployEvent(
        fillTx.hash,
        receipt.blockHash
      );

      const ESCROW_SRC_IMPLEMENTATION =
        await this.evmEscrowFactory.getSourceImpl();
      const srcEscrowAddress = this.calculateEvmEscrowAddress(
        true,
        srcEscrowEvent[0],
        ESCROW_SRC_IMPLEMENTATION
      );
      console.log(
        "✅ Sepolia source escrow address:",
        srcEscrowAddress.toString()
      );

      console.log("\n🏗️ Deploying destination escrow on Monad...");
      const dstImmutables = srcEscrowEvent[0]
        .withComplement(srcEscrowEvent[1])
        .withTaker(
          new Sdk.EvmAddress(new Sdk.Address(config.monad.resolverContract))
        );
      const dstDeployTx = this.monadResolver.deployDst(dstImmutables);

      console.log("\n🚀 Sending transaction...");
      const dstFillTx = await monadResolverWallet.sendTransaction(dstDeployTx);
      console.log(
        `✅ Monad fill transaction: ${getExplorerLink(
          config.monad.chainId,
          dstFillTx.hash
        )}`
      );
      const dstReceipt = await dstFillTx.wait(1);
      const dstDeployedAt = BigInt((await dstReceipt.getBlock()).timestamp);

      const ESCROW_DST_IMPLEMENTATION =
        await this.monadEscrowFactory.getDestinationImpl();

      const dstEscrowAddress = this.calculateMonadEscrowAddress(
        false,
        srcEscrowEvent[0],
        ESCROW_DST_IMPLEMENTATION,
        srcEscrowEvent[1],
        dstDeployedAt
      );

      console.log(
        "✅ Monad destination escrow address:",
        dstEscrowAddress.toString()
      );

      console.log("\n💸 Withdrawing from Monad escrow...");
      const monadWithdrawTx = this.monadResolver.withdraw(
        dstEscrowAddress,
        secret,
        dstImmutables.withDeployedAt(dstDeployedAt)
      );
      const dstWithdrawTx = await monadResolverWallet.sendTransaction(
        monadWithdrawTx
      );
      await dstWithdrawTx.wait();
      console.log(
        `✅ Monad withdrawal transaction: ${getExplorerLink(
          config.monad.chainId,
          dstWithdrawTx.hash
        )}`
      );

      console.log("\n💸 Withdrawing from Sepolia escrow...");
      const withdrawTx = this.evmResolver.withdraw(
        srcEscrowAddress,
        secret,
        srcEscrowEvent[0]
      );

      const srcWithdrawTx = await evmResolverWallet.sendTransaction(withdrawTx);
      await srcWithdrawTx.wait();

      console.log(
        `✅ Sepolia withdrawal transaction: ${getExplorerLink(
          config.evm.chainId,
          srcWithdrawTx.hash
        )}`
      );
      console.log("\n🎉 Sepolia → Monad swap completed successfully!");
    } catch (error) {
      console.error("❌ Error during Sepolia → Monad swap:", error.message);
      throw error;
    }
  }

  async executeMonadToEvmSwap() {
    console.log("\n🔄 Executing Monad → Sepolia Swap");
    const srcToken = await this.selectToken(
      "monad",
      "Select source token (Monad):"
    );
    const dstToken = await this.selectToken(
      "evm",
      "Select destination token (Sepolia):"
    );

    const makingAmount = await this.getAmount(srcToken, "Enter making amount");
    const takingAmount = await this.getAmount(dstToken, "Enter taking amount");

    const userAddress = await monadUserWallet.getAddress();
    await this.checkMonadAllowance(srcToken, makingAmount, monadUserWallet);

    const { order, secret } = this.createOrder(
      config.monad,
      config.evm,
      srcToken.address,
      dstToken.address,
      makingAmount,
      takingAmount,
      userAddress
    );

    const confirmed = await this.confirmTransaction(
      order,
      srcToken,
      dstToken,
      "Monad → Sepolia"
    );
    if (!confirmed) {
      console.log("❌ Transaction cancelled");
      return;
    }

    try {
      console.log("\n📝 Signing order...");
      const typedData = order.getTypedData(config.monad.chainId);
      const { domain, types, message } = typedData;

      const cleanTypes = { ...types };
      delete cleanTypes.EIP712Domain;

      const signature = await monadUserWallet.signTypedData(
        {
          ...domain,
          name: "1inch Limit Order Protocol",
          version: "4",
          verifyingContract: config.monad.limitOrderProtocol,
        },
        cleanTypes,
        message
      );

      console.log("Signature:", signature);

      console.log("\n🔄 Preparing fill order on Monad...");

      const deployTx = this.monadResolver.deploySrc(
        config.monad.chainId,
        order,
        signature,
        Sdk.TakerTraits.default()
          .setExtension(order.extension)
          .setAmountMode(Sdk.AmountMode.maker)
          .setAmountThreshold(order.takingAmount),
        makingAmount
      );

      console.log("\n🚀 Sending transaction...");
      const fillTx = await monadResolverWallet.sendTransaction(deployTx);
      console.log(
        `✅ Monad fill transaction: ${getExplorerLink(
          config.monad.chainId,
          fillTx.hash
        )}`
      );
      const receipt = await fillTx.wait(1);

      const srcEscrowEvent = await this.monadEscrowFactory.getSrcDeployEvent(
        fillTx.hash,
        receipt.blockHash
      );

      console.log("\n🏗️ Deploying destination escrow on Sepolia...");
      const dstImmutables = srcEscrowEvent[0]
        .withComplement(srcEscrowEvent[1])
        .withTaker(
          new Sdk.EvmAddress(new Sdk.Address(config.evm.resolverContract))
        );
      const dstDeployTx = this.evmResolver.deployDst(dstImmutables);

      console.log("\n🚀 Sending transaction...");
      const dstFillTx = await evmResolverWallet.sendTransaction(dstDeployTx);
      console.log(
        `✅ Sepolia fill transaction: ${getExplorerLink(
          config.evm.chainId,
          dstFillTx.hash
        )}`
      );
      const dstReceipt = await dstFillTx.wait(1);
      const dstDeployedAt = BigInt((await dstReceipt.getBlock()).timestamp);

      const ESCROW_SRC_IMPLEMENTATION =
        await this.monadEscrowFactory.getSourceImpl();
      const ESCROW_DST_IMPLEMENTATION =
        await this.evmEscrowFactory.getDestinationImpl();

      const srcEscrowAddress = this.calculateMonadEscrowAddress(
        true,
        srcEscrowEvent[0],
        ESCROW_SRC_IMPLEMENTATION
      );

      const dstEscrowAddress = this.calculateEvmEscrowAddress(
        false,
        srcEscrowEvent[0],
        ESCROW_DST_IMPLEMENTATION,
        srcEscrowEvent[1],
        dstDeployedAt
      );
      console.log(
        "✅ Monad source escrow address:",
        srcEscrowAddress.toString()
      );
      console.log(
        "✅ Sepolia destination escrow address:",
        dstEscrowAddress.toString()
      );

      console.log("\n💸 Withdrawing from Sepolia escrow...");
      const sepoliaWithdrawTx = this.evmResolver.withdraw(
        dstEscrowAddress,
        secret,
        dstImmutables.withDeployedAt(dstDeployedAt)
      );
      const dstWithdrawTx = await evmResolverWallet.sendTransaction(
        sepoliaWithdrawTx
      );
      await dstWithdrawTx.wait();
      console.log(
        `✅ Sepolia withdrawal transaction: ${getExplorerLink(
          config.evm.chainId,
          dstWithdrawTx.hash
        )}`
      );

      console.log("\n💸 Withdrawing from Monad escrow...");
      const withdrawTx = this.monadResolver.withdraw(
        srcEscrowAddress,
        secret,
        srcEscrowEvent[0]
      );

      const srcWithdrawTx = await monadResolverWallet.sendTransaction(
        withdrawTx
      );
      await srcWithdrawTx.wait();

      console.log(
        `✅ Monad withdrawal transaction: ${getExplorerLink(
          config.monad.chainId,
          srcWithdrawTx.hash
        )}`
      );
      console.log("\n🎉 Monad → Sepolia swap completed successfully!");
    } catch (error) {
      console.error("❌ Error during Monad → Sepolia swap:", error.message);
      throw error;
    }
  }

  calculateEvmEscrowAddress(
    isSource,
    immutables,
    implementation,
    complement,
    dstDeployedAt
  ) {
    let escrowAddress;
    if (isSource) {
      escrowAddress = new Sdk.EvmEscrowFactory(
        new Sdk.EvmAddress(new Sdk.Address(config.evm.escrowFactory))
      ).getSrcEscrowAddress(immutables, implementation);
    } else {
      if (!complement || !dstDeployedAt) {
        throw new Error(
          "complement and dstDeployedAt are required for destination escrow address calculation"
        );
      }

      escrowAddress = new Sdk.EvmEscrowFactory(
        new Sdk.EvmAddress(new Sdk.Address(config.evm.escrowFactory))
      ).getDstEscrowAddress(
        immutables,
        complement,
        dstDeployedAt,
        new Sdk.EvmAddress(new Sdk.Address(config.evm.resolverContract)),
        implementation
      );
    }

    return escrowAddress;
  }

  calculateMonadEscrowAddress(
    isSource,
    immutables,
    implementation,
    complement,
    dstDeployedAt
  ) {
    let escrowAddress;
    if (isSource) {
      escrowAddress = new Sdk.EvmEscrowFactory(
        new Sdk.EvmAddress(new Sdk.Address(config.monad.escrowFactory))
      ).getSrcEscrowAddress(immutables, implementation);
    } else {
      if (!complement || !dstDeployedAt) {
        throw new Error(
          "complement and dstDeployedAt are required for destination escrow address calculation"
        );
      }

      escrowAddress = new Sdk.EvmEscrowFactory(
        new Sdk.EvmAddress(new Sdk.Address(config.monad.escrowFactory))
      ).getDstEscrowAddress(
        immutables,
        complement,
        dstDeployedAt,
        new Sdk.EvmAddress(new Sdk.Address(config.monad.resolverContract)),
        implementation
      );
    }

    return escrowAddress;
  }
}

const main = async () => {
  try {
    console.log("Fusion Cross-Chain Swap Manager");
    console.log("========================\n");

    const swapManager = new CrossChainSwapManager();
    swapManager.initialize();

    const direction = await swapManager.selectDirection();

    if (direction === "evm-to-monad") {
      await swapManager.executeEvmToMonadSwap();
    } else if (direction === "monad-to-evm") {
      await swapManager.executeMonadToEvmSwap();
    } else if (direction === "starknet-to-evm") {
      await swapManager.executeStarknetToEvmSwap();
    } else if (direction === "evm-to-starknet") {
      await swapManager.executeEvmToStarknetSwap();
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error.stack);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
