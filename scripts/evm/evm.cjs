const { readFileSync } = require("fs");
const Sdk = require("@1inch/cross-chain-sdk");
const { Signature, ethers, Interface, id } = require("ethers");

const escrowAbi = JSON.parse(
  readFileSync("./abis/escrow-factory.json", "utf8")
);
const resolverAbi = JSON.parse(readFileSync("./abis/resolver.json", "utf8"));

class EVMEscrowFactory {
  iface = new Interface(escrowAbi.abi);

  constructor(provider, address) {
    if (!provider) throw new Error("Provider is required");
    if (!address) throw new Error("EscrowFactory address is required");

    this.address = address;
    this.provider = provider;
  }

  async getSourceImpl() {
    return new Sdk.EvmAddress(
      Sdk.Address.fromBigInt(
        BigInt(
          await this.provider.call({
            to: this.address,
            data: id("ESCROW_SRC_IMPLEMENTATION()").slice(0, 10),
          })
        )
      )
    );
  }

  async getDestinationImpl() {
    return Sdk.EvmAddress.fromBigInt(
      BigInt(
        await this.provider.call({
          to: this.address,
          data: id("ESCROW_DST_IMPLEMENTATION()").slice(0, 10),
        })
      )
    );
  }

  async getSrcDeployEvent(txHash, blockHash) {
    const event = this.iface.getEvent("SrcEscrowCreated");
    for (let i = 0; i < 10; i++) {
      try {
        const receipt = await this.provider.getTransactionReceipt(txHash);
        if (!receipt || receipt.status === 0) {
          await new Promise((r) => setTimeout(r, 8000));
          continue;
        }

        const logs = await this.provider.getLogs({
          blockHash,
          address: this.address,
          topics: [event.topicHash],
        });

        if (logs.length === 0) throw new Error("No event found");

        const decodedLog = this.iface.decodeEventLog(
          event,
          logs[0].data,
          logs[0].topics
        );

        const immutables = decodedLog[0];
        const complement = decodedLog[1];

        return [
          Sdk.Immutables.new({
            orderHash: immutables[0],
            hashLock: Sdk.HashLock.fromString(immutables[1]),
            maker: Sdk.EvmAddress.fromBigInt(immutables[2]),
            taker: Sdk.EvmAddress.fromBigInt(immutables[3]),
            token: Sdk.EvmAddress.fromBigInt(immutables[4]),
            amount: immutables[5],
            safetyDeposit: immutables[6],
            timeLocks: Sdk.TimeLocks.fromBigInt(immutables[7]),
          }),
          Sdk.DstImmutablesComplement.new({
            maker: Sdk.EvmAddress.fromBigInt(complement[0]),
            taker: Sdk.EvmAddress.fromBigInt(complement[0]), // Check if this should be complement[1]
            amount: complement[1],
            token: Sdk.EvmAddress.fromBigInt(complement[2]),
            safetyDeposit: complement[3],
          }),
        ];
      } catch (error) {
        console.log(`Attempt ${i + 1} failed:`, error.message);
        if (i === 9) throw error;
        await new Promise((r) => setTimeout(r, 8000));
      }
    }
  }
}

class EVMResolver {
  iface = new Interface(resolverAbi);

  constructor(resolverAddress, lopAddress) {
    if (!resolverAddress) throw new Error("evm address is required");
    if (!lopAddress)
      throw new Error("Limit Order Protocol address is required");

    this.resolverAddress = resolverAddress;
    this.lopAddress = lopAddress;
  }

  deploySrc(
    chainId,
    order,
    signature,
    takerTraits,
    amount,
    hashLock = order.escrowExtension.hashLockInfo
  ) {
    const { r, yParityAndS: vs } = Signature.from(signature);
    const { args, trait } = takerTraits.encode();
    const immutables = order
      .toSrcImmutables(
        chainId,
        new Sdk.EvmAddress(new Sdk.Address(this.resolverAddress)),
        amount,
        hashLock
      )
      .build();

    return {
      to: this.resolverAddress,
      data: this.iface.encodeFunctionData("deploySrc", [
        immutables,
        order.build(),
        r,
        vs,
        amount,
        trait,
        args,
      ]),
      value: order.escrowExtension.srcSafetyDeposit,
      gasLimit: 500000,
    };
  }

  deployDst(immutables) {
    return {
      to: this.resolverAddress,
      data: this.iface.encodeFunctionData("deployDst", [
        immutables.build(),
        immutables.timeLocks.toSrcTimeLocks().privateCancellation,
      ]),
      value: immutables.safetyDeposit,
      gasLimit: 500000,
    };
  }

  hashOrder(srcChainId, order) {
    const typedData = order.getTypedData(srcChainId);
    const domain = {
      name: "1inch Aggregation Router",
      version: "6",
      verifyingContract: this.lopAddress,
    };
    return ethers.TypedDataEncoder.hash(
      domain,
      { Order: typedData.types[typedData.primaryType] },
      order.build()
    );
  }

  withdraw(escrow, secret, immutables) {
    return {
      to: this.resolverAddress,
      data: this.iface.encodeFunctionData("withdraw", [
        escrow.toString(),
        secret,
        immutables.build(),
      ]),
      gasLimit: 500000,
    };
  }

  cancel(side, escrow, immutables) {
    return {
      to: this.resolverAddress,
      data: this.iface.encodeFunctionData("cancel", [
        escrow.toString(),
        immutables.build(),
      ]),
      gasLimit: 500000,
    };
  }
}

module.exports = { EVMEscrowFactory, EVMResolver };
