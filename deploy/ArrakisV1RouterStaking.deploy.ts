import { deployments, getNamedAccounts } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getAddresses } from "../src/addresses";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  if (
    hre.network.name === "mainnet" ||
    hre.network.name === "optimism" ||
    hre.network.name === "polygon" ||
    hre.network.name === "arbitrum"
  ) {
    console.log(
      `!! Deploying ArrakisV1RouterStaking to ${hre.network.name}. Hit ctrl + c to abort`
    );
    await new Promise((r) => setTimeout(r, 20000));
  }

  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const addresses = getAddresses(hre.network.name);

  await deploy("ArrakisV1RouterStaking", {
    from: deployer,
    proxy: {
      proxyContract: "EIP173ProxyWithReceive",
      owner: addresses.ArrakisDevMultiSig,
      execute: {
        init: {
          methodName: "initialize",
          args: [],
        },
      },
    },
    args: [addresses.WETH],
    log: hre.network.name !== "hardhat",
  });
};

func.skip = async (hre: HardhatRuntimeEnvironment) => {
  const shouldSkip =
    hre.network.name === "mainnet" ||
    hre.network.name === "polygon" ||
    hre.network.name === "optimism" ||
    hre.network.name === "arbitrum" ||
    hre.network.name === "goerli";
  return shouldSkip ? true : false;
};

func.tags = ["ArrakisV1RouterStaking"];

export default func;
