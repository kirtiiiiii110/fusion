const Sdk = require("@1inch/cross-chain-sdk");
const { Account, RpcProvider, CallData, cairo, hash } = require("starknet");
const { config } = require("../config.cjs");
const { Contract } = require("starknet");
const { parseEther } = require("ethers");

class StarknetHTLC {
  constructor() {
    const provider = new RpcProvider({
      nodeUrl: config.starknet.rpcUrl,
      specVersion: "0.8.1",
    });
    this.provider = provider;

    this.wallet = new Account(
      provider,
      config.starknet.resolverAddress,
      config.starknet.resolverPrivateKey
    );

    this.htlcContract = config.starknet.htlcContract;
  }

  async deploySrc(maker, order, hashlock) {
    try {
      const orderImmutables = {
        orderHash: order.orderHash,
        hashlock,
        maker,
        taker: config.starknet.resolverContract,
        token: order.makerAsset,
        amount: order.makingAmount,
        safetyDeposit: parseEther("0.000001"),
      };

      const timelocks = {
        src_withdrawal: Number(1),
        src_public_withdrawal: Number(1200),
        src_cancellation: Number(1210),
        src_public_cancellation: Number(1220),
      };

      const tx = await this.wallet.execute([
        {
          contractAddress: this.htlcContract,
          entrypoint: "create_escrow_src",
          calldata: CallData.compile({
            depositor: orderImmutables.maker,
            token_contract: config.starknet.token,
            safety_token_contract: config.starknet.token,
            token_amount: cairo.uint256(orderImmutables.amount.toString()),
            safety_deposit: cairo.uint256(
              orderImmutables.safetyDeposit.toString()
            ),
            hashlock: orderImmutables.hashlock,
            withdrawal: timelocks.src_withdrawal,
            public_withdrawal: timelocks.src_public_withdrawal,
            cancellation: timelocks.src_cancellation,
            public_cancellation: timelocks.src_public_cancellation,
            salt: hash.computeHashOnElements([Date.now().toString()]),
          }),
        },
      ]);

      const receipt = await this.provider.waitForTransaction(
        tx.transaction_hash
      );
      if (!receipt.isSuccess()) {
        throw new Error("Failed to deploy src escrow");
      }

      const escrowCreatedEvent = receipt.value.events.find(
        (event) => event.keys && event.keys[0] === config.starknet.eventKey
      );

      const escrowId = escrowCreatedEvent ? escrowCreatedEvent.data[0] : null;

      return {
        txHash: tx.transaction_hash,
        receipt,
        escrowId,
        blockTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      };
    } catch (error) {
      console.error("Error in deploySrc:", error);
      throw error;
    }
  }

  async deployDst(immutables) {
    try {
      const tx = await this.wallet.execute([
        {
          contractAddress: this.htlcContract,
          entrypoint: "create_escrow_dst",
          calldata: CallData.compile({
            token_contract: config.starknet.token,
            safety_token_contract: config.starknet.token,
            token_amount: cairo.uint256(immutables.amount.toString()),
            safety_deposit: cairo.uint256(immutables.safety_deposit.toString()),
            taker: immutables.taker,
            hashlock: immutables.hash_lock,
            withdrawal: immutables.timelocks.dst_withdrawal,
            public_withdrawal: immutables.timelocks.dst_public_withdrawal,
            cancellation: immutables.timelocks.dst_cancellation,
            public_cancellation: immutables.timelocks.dst_cancellation,
            salt: hash.computeHashOnElements([Date.now().toString()]),
          }),
        },
      ]);

      const receipt = await this.provider.waitForTransaction(
        tx.transaction_hash
      );
      if (!receipt.isSuccess()) {
        throw new Error("Failed to deploy dst escrow");
      }

      const a = receipt.value.events.find(
        (e) => e.from_address === config.starknet.htlcContract
      );
      const escrowCreatedEvent = receipt.value.events.find(
        (event) => event.keys && event.keys[0] === config.starknet.eventKey
      );

      const escrowId = escrowCreatedEvent ? escrowCreatedEvent.data[0] : null;

      return {
        dstEscrowId: escrowId,
        txHash: tx.transaction_hash,
        receipt,
      };
    } catch (error) {
      console.error("Error in deployDst:", error);
      throw error;
    }
  }

  async withdraw(escrowId, secret) {
    try {
      const tx = await this.wallet.execute([
        {
          contractAddress: this.htlcContract,
          entrypoint: "withdraw",
          calldata: CallData.compile({
            escrow_id: escrowId,
            secret: secret,
          }),
        },
      ]);

      const receipt = await this.provider.waitForTransaction(
        tx.transaction_hash
      );
      if (!receipt.isSuccess()) {
        throw new Error("Failed to withdraw from escrow");
      }

      return { txHash: tx.transaction_hash, receipt };
    } catch (error) {
      console.error("Error in withdraw:", error);
      throw error;
    }
  }

  async cancel(escrowId) {
    try {
      const tx = await this.wallet.execute([
        {
          contractAddress: this.htlcContract,
          entrypoint: "cancel",
          calldata: CallData.compile({
            escrow_id: escrowId,
          }),
        },
      ]);

      const receipt = await this.provider.waitForTransaction(
        tx.transaction_hash
      );
      if (!receipt.isSuccess()) {
        throw new Error("Failed to cancel escrow");
      }

      return { txHash: tx.transaction_hash, receipt };
    } catch (error) {
      console.error("Error in cancel:", error);
      throw error;
    }
  }

  async getEscrowInfo(escrowId) {
    try {
      const result = await this.provider.callContract({
        contractAddress: this.htlcContract,
        entrypoint: "get_escrow_info",
        calldata: [escrowId],
      });

      return result.result;
    } catch (error) {
      console.error("Error getting escrow info:", error);
      throw error;
    }
  }

  async isWithdrawalAllowed(escrowId, caller) {
    try {
      const result = await this.provider.callContract({
        contractAddress: this.htlcContract,
        entrypoint: "is_withdrawal_allowed",
        calldata: [escrowId, caller],
      });

      return result.result[0] === "0x1";
    } catch (error) {
      console.error("Error checking withdrawal allowance:", error);
      return false;
    }
  }

  async isCancellationAllowed(escrowId, caller) {
    try {
      const result = await this.provider.callContract({
        contractAddress: this.htlcContract,
        entrypoint: "is_cancellation_allowed",
        calldata: [escrowId, caller],
      });

      return result.result[0] === "0x1";
    } catch (error) {
      console.error("Error checking cancellation allowance:", error);
      return false;
    }
  }

  convertToFelt252(value) {
    if (typeof value === "string" && value.startsWith("0x")) {
      return value;
    }
    const bigIntValue =
      typeof value === "string" ? BigInt(value) : BigInt(value.toString());
    return "0x" + bigIntValue.toString(16);
  }

  convertAddressToFelt252(address) {
    if (typeof address === "string" && address.startsWith("0x")) {
      return address;
    }
    return "0x" + address.replace("0x", "").padStart(64, "0");
  }
}

module.exports = { StarknetHTLC };
