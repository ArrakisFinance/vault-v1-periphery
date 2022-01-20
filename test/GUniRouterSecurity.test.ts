import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { deployments, ethers, network } from "hardhat";
import { Addresses, getAddresses } from "../src/addresses";
import { EIP173ProxyWithReceive } from "../typechain/EIP173ProxyWithReceive";
import { GUniRouter } from "../typechain/GUniRouter";
import { IGUniPool } from "../typechain/IGUniPool";

let addresses: Addresses;
let wallet: SignerWithAddress;
let walletAddress: string;

describe("G-UNI Router: Security Tests", function () {
  this.timeout(0);
  let gUniPool: IGUniPool;
  let gUniRouter: GUniRouter;
  let proxy: EIP173ProxyWithReceive;
  before(async function () {
    await deployments.fixture();
    addresses = getAddresses(network.name);

    [wallet] = await ethers.getSigners();
    walletAddress = await wallet.getAddress();

    const gUniFactory = await ethers.getContractAt(
      ["function getGelatoPools() external view returns(address[] memory)"],
      addresses.GUniFactory
    );
    const pools = await gUniFactory.getGelatoPools();
    const poolAddress = pools[0];
    gUniPool = (await ethers.getContractAt(
      "IGUniPool",
      poolAddress
    )) as IGUniPool;

    const gUniRouterAddress = (await deployments.get("GUniRouter")).address;

    gUniRouter = (await ethers.getContractAt(
      "GUniRouter",
      gUniRouterAddress
    )) as GUniRouter;

    proxy = (await ethers.getContractAt(
      "EIP173ProxyWithReceive",
      gUniRouterAddress
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

      await gUniRouter.pause();
      await expect(
        gUniRouter.addLiquidity(gUniPool.address, 0, 0, 0, 0, walletAddress)
      ).to.be.revertedWith("Pausable: paused");
      await gUniRouter.transferOwnership(proxyOwner);
      const owner = await gUniRouter.owner();
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
