const hre = require("hardhat");

const wethByNetwork = {
    hardhat: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    mainnet: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    monad: "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701",
};

const deploy = async () => {
    const { deployments, getNamedAccounts, getChainId, network } = hre;

    console.log("running deploy script");
    console.log("network id ", await getChainId());

    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log({ deployer });

    const limitOrderProtocol = await deploy("LimitOrderProtocol", {
        from: deployer,
        args: [wethByNetwork[network.name]],
    });

    console.log("LimitOrderProtocol deployed to:", limitOrderProtocol.address);

    if ((await getChainId()) !== "31337") {
        await hre.run("verify:verify", {
            address: limitOrderProtocol.address,
            constructorArguments: [wethByNetwork[network.name]],
        });
    }
};
deploy();

// module.exports.skip = async () => true;
