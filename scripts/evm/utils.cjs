const { ethers, Contract } = require("ethers");
const { readFileSync } = require("fs");

const getOrderHash = (chainId, order, custom = {}) => {
  const typedData = order.getTypedData(chainId);
  typedData.domain = {
    ...typedData.domain,
    name: "1inch Aggregation Router",
    version: "6",
    ...custom,
  };

  return ethers.TypedDataEncoder.hash(
    typedData.domain,
    { Order: typedData.types.Order },
    order.build()
  );
};

const transferNativeToken = async (wallet, to, amount) => {
  const tx = await wallet.sendTransaction({
    to,
    value: amount,
  });
  await tx.wait();
};

const transferToken = async (wallet, tokenAddress, to, amount) => {
  const abi = JSON.parse(readFileSync("./abis/erc20.json", "utf8"));
  const tokenContract = new Contract(tokenAddress, abi.abi, wallet);

  const tx = await tokenContract.transfer(to, amount);
  await tx.wait();
};

const setDeployedAt = (timelocks, value) => {
  timelocks = BigInt(timelocks);
  value = BigInt(value);
  const cleared =
    timelocks &
    ~0xffffffff00000000000000000000000000000000000000000000000000000000n;
  const shiftedValue = value << 224n;
  return cleared | shiftedValue;
};

module.exports = {
  getOrderHash,
  transferNativeToken,
  transferToken,
  setDeployedAt,
};
