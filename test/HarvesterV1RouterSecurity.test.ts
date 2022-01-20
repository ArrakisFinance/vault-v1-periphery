import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { deployments, ethers, network } from "hardhat";
import { Addresses, getAddresses } from "../src/addresses";
import { EIP173ProxyWithReceive } from "../typechain/EIP173ProxyWithReceive";
import { HarvesterV1Router } from "../typechain/HarvesterV1Router";
import { IHarvesterV1 } from "../typechain/IHarvesterV1";

let addresses: Addresses;
let wallet: SignerWithAddress;
let walletAddress: string;

describe("HarvesterV1 Router: Security Tests", function () {
  this.timeout(0);
  let harvesterV1: IHarvesterV1;
  let harvesterV1Router: HarvesterV1Router;
  let proxy: EIP173ProxyWithReceive;
  before(async function () {
    await deployments.fixture();
    addresses = getAddresses(network.name);

    [wallet] = await ethers.getSigners();
    walletAddress = await wallet.getAddress();

    const gUniFactory = await ethers.getContractAt(
      [
        "function getDeployers() external view returns(address[] memory)",
        "function getPools(address) external view returns(address[] memory)",
      ],
      addresses.HarvesterV1Factory
    );
    const deployers = await gUniFactory.getDeployers();
    const pools = await gUniFactory.getPools(deployers[0]);
    const poolAddress = pools[0];
    harvesterV1 = (await ethers.getContractAt(
      "IHarvesterV1",
      poolAddress
    )) as IHarvesterV1;

    const harvesterV1RouterAddress = (
      await deployments.get("HarvesterV1Router")
    ).address;

    harvesterV1Router = (await ethers.getContractAt(
      "HarvesterV1Router",
      harvesterV1RouterAddress
    )) as HarvesterV1Router;

    proxy = (await ethers.getContractAt(
      "EIP173ProxyWithReceive",
      harvesterV1RouterAddress
    )) as EIP173ProxyWithReceive;

    await network.provider.send("hardhat_setBalance", [
      await proxy.proxyAdmin(),
      "0x313030303030303030303030303030303030303030",
    ]);

    await network.provider.send("hardhat_setBalance", [
      walletAddress,
      "0x313030303030303030303030303030303030303030",
    ]);
  });

  describe("Upgradable tests", function () {
    it("Pause, Revocation, Ownership, Upgradeability", async function () {
      const proxyOwner = await proxy.proxyAdmin();

      await harvesterV1Router.pause();
      await expect(
        harvesterV1Router.addLiquidity(
          harvesterV1.address,
          0,
          0,
          0,
          0,
          walletAddress
        )
      ).to.be.revertedWith("Pausable: paused");
      await harvesterV1Router.transferOwnership(proxyOwner);
      const owner = await harvesterV1Router.owner();
      expect(owner).to.be.eq(proxyOwner);
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [proxyOwner],
      });
      const proxySigner = await ethers.provider.getSigner(proxyOwner);

      await proxy.connect(proxySigner).upgradeTo(ethers.constants.AddressZero);

      await proxy
        .connect(proxySigner)
        .transferProxyAdmin(ethers.constants.AddressZero);
    });
  });
});
