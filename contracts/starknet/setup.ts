import { readFileSync } from "fs";
import {
  cairo,
  Contract,
  Account,
  ec,
  json,
  stark,
  RpcProvider,
  hash,
  CallData,
  CairoOption,
  CairoOptionVariant,
  CairoCustomEnum,
} from "starknet";

const provider = new RpcProvider({
  nodeUrl: "https://starknet-sepolia.public.blastapi.io",
});

const compiledTestSierra = json.parse(
  readFileSync(
    "./target/dev/fusion_starknet_Factory.contract_class.json"
  ).toString("ascii")
);

const deployUserAccount = async () => {
  const argentXaccountClassHash =
    "0x029927c8af6bccf3f6fda035981e765a7bdbf18a2dc0d630494f8758aa908e2b";

  const privateKeyAX = stark.randomAddress();
  const starkKeyPubAX = ec.starkCurve.getStarkKey(privateKeyAX);

  const axSigner = new CairoCustomEnum({ Starknet: { pubkey: starkKeyPubAX } });
  const axGuardian = new CairoOption<unknown>(CairoOptionVariant.None);
  const AXConstructorCallData = CallData.compile({
    owner: axSigner,
    guardian: axGuardian,
  });
  const AXcontractAddress = hash.calculateContractAddressFromHash(
    starkKeyPubAX,
    argentXaccountClassHash,
    AXConstructorCallData,
    0
  );

  const accountAX = new Account(provider, AXcontractAddress, privateKeyAX);

  const deployAccountPayload = {
    classHash: argentXaccountClassHash,
    constructorCalldata: AXConstructorCallData,
    contractAddress: AXcontractAddress,
    addressSalt: starkKeyPubAX,
  };

  const { transaction_hash: AXdAth, contract_address: AXcontractFinalAddress } =
    await accountAX.deployAccount(deployAccountPayload);
  console.log("✅ ArgentX wallet deployed at:", AXcontractFinalAddress);
};

const deployFactoryContract = async () => {
  const account = new Account(
    provider,
    process.env.ADDRESS as string,
    process.env.PRIVATE_KEY as string
  );

  const deployResponse = await account.deployContract({
    classHash:
      "0x06de90c04bd5a9028b2db4b21115c370d355ed134b4fefd373fd2f4b1887c4f7",
    constructorCalldata: CallData.compile({
      owner:
        "0x007CD53499F0665a742A09d53081Eef5460BEA01E7a2fC1fbD50bc9eB5b6e33A",
    }),
  });

  const factoryContract = new Contract(
    compiledTestSierra.abi,
    deployResponse.contract_address,
    provider
  );

  console.log("Transaction hash: ", deployResponse.transaction_hash);
  console.log("Factory contract address: ", factoryContract.address);

  return factoryContract.address;
};

const approveResolverToFactory = async (factory: string) => {
  const resolverAccount = new Account(
    provider,
    process.env.ADDRESS as string,
    process.env.PRIVATE_KEY as string
  );

  const { abi } = await provider.getClassAt(
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
  );

  const starknetToken = new Contract(
    abi,
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    resolverAccount
  );

  const allowanceAmount = cairo.uint256(100000n * 10n ** 18n);
  const approveTx = await starknetToken.approve(factory, allowanceAmount);
  await provider.waitForTransaction(approveTx.transaction_hash);

  const allowance = await starknetToken.allowance(
    resolverAccount.address,
    factory
  );
  console.log("Current Allowance:", allowance);
};

const setup = async () => {
  const factoryContractAddress = await deployFactoryContract();
  await approveResolverToFactory(factoryContractAddress);
};

setup().catch((error) => {
  console.error(error);
});
