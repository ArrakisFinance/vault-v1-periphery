import { expect } from "chai";
import { deployments, ethers, network } from "hardhat";
import { IERC20, ArrakisV1RouterStaking, IArrakisVaultV1 } from "../typechain";
import { ArrakisV1RouterWrapper } from "../typechain/ArrakisV1RouterWrapper";
import { ArrakisSwappersWhitelist } from "../typechain/ArrakisSwappersWhitelist";
import { ArrakisV1Resolver } from "../typechain/ArrakisV1Resolver";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { Addresses, getAddresses } from "../src/addresses";
import { swapTokenData, quote1Inch } from "../src/oneInchApiIntegration";
import Gauge from "../src/LiquidityGaugeV4.json";
import { BigNumber, Contract } from "ethers";

let addresses: Addresses;

const ANGLE = "0x31429d1856aD1377A8A0079410B297e1a9e214c2";
const veANGLE = "0x0C462Dbb9EC8cD1630f1728B2CFD2769d09f0dd5";
const veBoost = "0x52701bFA0599db6db2b2476075D9a2f4Cb77DAe3";

const WAD = ethers.BigNumber.from("10").pow("18");

describe("ArrakisV1 Staking Router tests", function () {
  this.timeout(0);
  let wallet: SignerWithAddress;
  let token0: IERC20;
  let token1: IERC20;
  let rakisToken: IERC20;
  let stRakisToken: IERC20;
  let vault: IArrakisVaultV1;
  let vaultRouterWrapper: ArrakisV1RouterWrapper;
  let vaultRouter: ArrakisV1RouterStaking;
  let swappersWhitelist: ArrakisSwappersWhitelist;
  let resolver: ArrakisV1Resolver;
  let gauge: Contract;
  let contractBalanceEth: BigNumber | undefined;
  before(async function () {
    await deployments.fixture();

    addresses = getAddresses(network.name);
    [wallet] = await ethers.getSigners();

    const faucet = "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7";

    await network.provider.send("hardhat_setBalance", [
      faucet,
      "0x313030303030303030303030303030303030303030",
    ]);
    const arrakisFactory = await ethers.getContractAt(
      [
        "function getDeployers() external view returns(address[] memory)",
        "function getPools(address) external view returns(address[] memory)",
      ],
      addresses.ArrakisV1Factory
    );
    const deployers = await arrakisFactory.getDeployers();
    const pools = await arrakisFactory.getPools(deployers[0]);
    const poolAddress = pools[0];
    console.log("poolAddress: ", poolAddress);
    vault = (await ethers.getContractAt(
      "IArrakisVaultV1",
      poolAddress
    )) as IArrakisVaultV1;
    token0 = (await ethers.getContractAt(
      "IERC20",
      await vault.token0()
    )) as IERC20;
    token1 = (await ethers.getContractAt(
      "IERC20",
      await vault.token1()
    )) as IERC20;
    rakisToken = (await ethers.getContractAt("IERC20", poolAddress)) as IERC20;

    const swappersWhitelistAddress = (
      await deployments.get("ArrakisSwappersWhitelist")
    ).address;

    swappersWhitelist = (await ethers.getContractAt(
      "ArrakisSwappersWhitelist",
      swappersWhitelistAddress
    )) as ArrakisSwappersWhitelist;

    await swappersWhitelist.addToWhitelist(addresses.OneInchRouter);

    const vaultRouterAddress = (await deployments.get("ArrakisV1RouterStaking"))
      .address;

    vaultRouter = (await ethers.getContractAt(
      "ArrakisV1RouterStaking",
      vaultRouterAddress
    )) as ArrakisV1RouterStaking;

    const vaultRouterWrapperAddress = (
      await deployments.get("ArrakisV1RouterWrapper")
    ).address;

    vaultRouterWrapper = (await ethers.getContractAt(
      "ArrakisV1RouterWrapper",
      vaultRouterWrapperAddress
    )) as ArrakisV1RouterWrapper;

    await vaultRouterWrapper.updateRouter(vaultRouter.address);

    const resolverAddress = (await deployments.get("ArrakisV1Resolver"))
      .address;
    resolver = (await ethers.getContractAt(
      "ArrakisV1Resolver",
      resolverAddress
    )) as ArrakisV1Resolver;

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [faucet],
    });
    const faucetSigner = await ethers.provider.getSigner(faucet);
    await token0
      .connect(faucetSigner)
      .transfer(await wallet.getAddress(), await token0.balanceOf(faucet));
    await token1
      .connect(faucetSigner)
      .transfer(await wallet.getAddress(), await token1.balanceOf(faucet));

    const gaugeImplFactory = ethers.ContractFactory.fromSolidity(Gauge);
    const gaugeImpl = await gaugeImplFactory
      .connect(wallet)
      .deploy({ gasLimit: 6000000 });
    const encoded = gaugeImpl.interface.encodeFunctionData("initialize", [
      vault.address,
      await wallet.getAddress(),
      ANGLE,
      veANGLE,
      veBoost,
      await wallet.getAddress(),
    ]);
    const factory = await ethers.getContractFactory("EIP173Proxy");
    const contract = await factory
      .connect(wallet)
      .deploy(gaugeImpl.address, await wallet.getAddress(), encoded);
    gauge = await ethers.getContractAt(Gauge.abi, contract.address);
    stRakisToken = (await ethers.getContractAt(
      "IERC20",
      gauge.address
    )) as IERC20;

    contractBalanceEth = await wallet.provider?.getBalance(vaultRouter.address);
    // expect(contractBalanceEth).to.equal(1);
  });

  describe("deposits through ArrakisV1RouterStaking", function () {
    it("should deposit funds with addLiquidity", async function () {
      await token0
        .connect(wallet)
        .approve(
          vaultRouterWrapper.address,
          ethers.utils.parseEther("1000000")
        );
      await token1
        .connect(wallet)
        .approve(vaultRouterWrapper.address, ethers.utils.parseEther("100000"));
      const balance0Before = await token0.balanceOf(await wallet.getAddress());
      const balance1Before = await token1.balanceOf(await wallet.getAddress());
      const balanceArrakisV1Before = await rakisToken.balanceOf(
        await wallet.getAddress()
      );

      const input0 = WAD.mul(ethers.BigNumber.from("100"));
      const input1 = "100000000";
      const addLiquidityData = {
        amount0Max: input0,
        amount1Max: input1,
        amount0Min: 0,
        amount1Min: 0,
        receiver: await wallet.getAddress(),
        useETH: false,
        gaugeAddress: "0x0000000000000000000000000000000000000000",
      };
      await vaultRouterWrapper.addLiquidity(vault.address, addLiquidityData);
      const balance0After = await token0.balanceOf(await wallet.getAddress());
      const balance1After = await token1.balanceOf(await wallet.getAddress());
      const balanceArrakisV1After = await rakisToken.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0Before).to.be.gt(balance0After);
      expect(balance1Before).to.be.gt(balance1After);
      expect(balanceArrakisV1Before).to.be.lt(balanceArrakisV1After);

      const contractBalance0 = await token0.balanceOf(vaultRouter.address);
      const contractBalance1 = await token1.balanceOf(vaultRouter.address);
      const contractBalanceG = await rakisToken.balanceOf(vaultRouter.address);

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalanceG).to.equal(ethers.constants.Zero);
    });
    it("should deposit funds with addLiquidityAndStake", async function () {
      await token0
        .connect(wallet)
        .approve(
          vaultRouterWrapper.address,
          ethers.utils.parseEther("1000000")
        );
      await token1
        .connect(wallet)
        .approve(vaultRouterWrapper.address, ethers.utils.parseEther("100000"));
      const balance0Before = await token0.balanceOf(await wallet.getAddress());
      const balance1Before = await token1.balanceOf(await wallet.getAddress());
      const balanceStakedBefore = await stRakisToken.balanceOf(
        await wallet.getAddress()
      );
      const balanceArrakisV1Before = await rakisToken.balanceOf(
        await wallet.getAddress()
      );

      await gauge
        .connect(wallet)
        .add_reward(token0.address, await wallet.getAddress(), {
          gasLimit: 6000000,
        });

      await token0
        .connect(wallet)
        .approve(gauge.address, WAD.mul(ethers.BigNumber.from("100")));

      await gauge.deposit_reward_token(
        token0.address,
        WAD.mul(ethers.BigNumber.from("100")),
        { gasLimit: 6000000 }
      );

      const input0 = WAD.mul(ethers.BigNumber.from("100"));
      const input1 = "100000000";
      const addLiquidityData = {
        amount0Max: input0,
        amount1Max: input1,
        amount0Min: 0,
        amount1Min: 0,
        receiver: await wallet.getAddress(),
        useETH: false,
        gaugeAddress: gauge.address,
      };
      await vaultRouterWrapper.addLiquidity(vault.address, addLiquidityData);
      const balance0After = await token0.balanceOf(await wallet.getAddress());
      const balance1After = await token1.balanceOf(await wallet.getAddress());
      const balanceStakedAfter = await stRakisToken.balanceOf(
        await wallet.getAddress()
      );
      const balanceArrakisV1After = await rakisToken.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0Before).to.be.gt(balance0After);
      expect(balance1Before).to.be.gt(balance1After);
      expect(balanceArrakisV1Before).to.be.eq(balanceArrakisV1After);
      expect(balanceStakedBefore).to.be.lt(balanceStakedAfter);

      const contractBalance0 = await token0.balanceOf(vaultRouter.address);
      const contractBalance1 = await token1.balanceOf(vaultRouter.address);
      const contractBalance2 = await rakisToken.balanceOf(vaultRouter.address);
      const contractBalance3 = await stRakisToken.balanceOf(
        vaultRouter.address
      );

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalance2).to.equal(ethers.constants.Zero);
      expect(contractBalance3).to.equal(ethers.constants.Zero);

      const newStartTime1 = (await wallet.provider?.getBlock("latest"))
        ?.timestamp;
      const dayLater1 = Number(newStartTime1?.toString()) + 86400;
      await network.provider.request({
        method: "evm_mine",
        params: [dayLater1],
      });

      const claimable = await gauge.claimable_reward(
        await wallet.getAddress(),
        token0.address
      );
      expect(claimable).to.be.gt(0);
    });
  });
  describe("withdrawal through ArrakisV1RouterStaking", function () {
    it("should withdraw funds with removeLiquidity", async function () {
      const balanceArrakisV1Before = await rakisToken.balanceOf(
        await wallet.getAddress()
      );
      expect(balanceArrakisV1Before).to.be.gt(ethers.constants.Zero);
      const balance0Before = await token0.balanceOf(await wallet.getAddress());
      const balance1Before = await token1.balanceOf(await wallet.getAddress());
      await rakisToken.approve(
        vaultRouterWrapper.address,
        ethers.utils.parseEther("100000000")
      );
      const removeLiquidity = {
        burnAmount: balanceArrakisV1Before,
        amount0Min: 0,
        amount1Min: 0,
        receiver: await wallet.getAddress(),
        receiveETH: false,
        gaugeAddress: "0x0000000000000000000000000000000000000000",
      };
      await vaultRouterWrapper.removeLiquidity(vault.address, removeLiquidity);
      const balance0After = await token0.balanceOf(await wallet.getAddress());
      const balance1After = await token1.balanceOf(await wallet.getAddress());
      const balanceArrakisV1After = await rakisToken.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0After).to.be.gt(balance0Before);
      expect(balance1After).to.be.gt(balance1Before);
      expect(balanceArrakisV1Before).to.be.gt(balanceArrakisV1After);
    });
    it("should withdraw funds with removeLiquidityAndUnstake", async function () {
      const balanceStakedBefore = await stRakisToken.balanceOf(
        await wallet.getAddress()
      );
      expect(balanceStakedBefore).to.be.gt(ethers.constants.Zero);
      const balance0Before = await token0.balanceOf(await wallet.getAddress());
      const balance1Before = await token1.balanceOf(await wallet.getAddress());
      await stRakisToken.approve(
        vaultRouterWrapper.address,
        ethers.utils.parseEther("100000000")
      );
      const removeLiquidity = {
        burnAmount: balanceStakedBefore,
        amount0Min: 0,
        amount1Min: 0,
        receiver: await wallet.getAddress(),
        receiveETH: false,
        gaugeAddress: gauge.address,
      };
      await vaultRouterWrapper.removeLiquidity(vault.address, removeLiquidity);
      const balance0After = await token0.balanceOf(await wallet.getAddress());
      const balance1After = await token1.balanceOf(await wallet.getAddress());
      const balanceStakedAfter = await stRakisToken.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0After).to.be.gt(balance0Before);
      expect(balance1After).to.be.gt(balance1Before);
      expect(balanceStakedBefore).to.be.gt(balanceStakedAfter);
      expect(balanceStakedAfter).to.eq(0);
    });
  });
  describe("ETH methods", function () {
    it("addLiquidityETH, removeLiquidityETH", async function () {
      const arrakisWethVault = (await ethers.getContractAt(
        "IArrakisVaultV1",
        addresses.ArrakisV1WethPool
      )) as IArrakisVaultV1;
      const token0W = (await ethers.getContractAt(
        "IERC20",
        await arrakisWethVault.token0()
      )) as IERC20;
      const token1W = (await ethers.getContractAt(
        "IERC20",
        await arrakisWethVault.token1()
      )) as IERC20;
      const rakisTokenW = (await ethers.getContractAt(
        "IERC20",
        addresses.ArrakisV1WethPool
      )) as IERC20;

      expect(await arrakisWethVault.token1()).to.equal(addresses.WETH);

      // addLiquidityETH

      await token0W
        .connect(wallet)
        .approve(
          vaultRouterWrapper.address,
          ethers.utils.parseEther("1000000")
        );
      let balance0Before = await token0W.balanceOf(await wallet.getAddress());
      let balance1Before = await wallet.provider?.getBalance(
        await wallet.getAddress()
      );
      let balanceArrakisV1Before = await rakisTokenW.balanceOf(
        await wallet.getAddress()
      );

      const input0 = "100000000";
      const input1 = WAD.mul(ethers.BigNumber.from("2"));
      const addLiquidityData = {
        amount0Max: input0,
        amount1Max: input1,
        amount0Min: 0,
        amount1Min: 0,
        receiver: await wallet.getAddress(),
        useETH: true,
        gaugeAddress: "0x0000000000000000000000000000000000000000",
      };
      await vaultRouterWrapper.addLiquidity(
        arrakisWethVault.address,
        addLiquidityData,
        { value: input1 }
      );

      let balance0After = await token0W.balanceOf(await wallet.getAddress());
      let balance1After = await wallet.provider?.getBalance(
        await wallet.getAddress()
      );
      let balanceArrakisV1After = await rakisTokenW.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0Before).to.be.gt(balance0After);
      expect(balance1Before).to.be.gt(balance1After);
      expect(balanceArrakisV1Before).to.be.lt(balanceArrakisV1After);

      let contractBalance0 = await token0W.balanceOf(vaultRouter.address);
      let contractBalance1 = await token1W.balanceOf(vaultRouter.address);
      let contractBalanceG = await rakisTokenW.balanceOf(vaultRouter.address);
      let contractBalanceEthEnd = await wallet.provider?.getBalance(
        vaultRouter.address
      );

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalanceG).to.equal(ethers.constants.Zero);
      expect(contractBalanceEth).to.equal(contractBalanceEthEnd);

      balance0Before = balance0After;
      balance1Before = balance1After;
      balanceArrakisV1Before = balanceArrakisV1After;

      // removeLiquidityETH

      await rakisTokenW.approve(
        vaultRouterWrapper.address,
        balanceArrakisV1Before
      );
      const removeLiquidity = {
        burnAmount: balanceArrakisV1Before,
        amount0Min: 0,
        amount1Min: 0,
        receiver: await wallet.getAddress(),
        receiveETH: true,
        gaugeAddress: "0x0000000000000000000000000000000000000000",
      };
      await vaultRouterWrapper.removeLiquidity(
        arrakisWethVault.address,
        removeLiquidity
      );
      balance0After = await token0.balanceOf(await wallet.getAddress());
      balance1After = await wallet.provider?.getBalance(
        await wallet.getAddress()
      );
      balanceArrakisV1After = await rakisTokenW.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0After).to.be.gt(balance0Before);
      expect(balance1After).to.be.gt(balance1Before);
      expect(balanceArrakisV1Before).to.be.gt(balanceArrakisV1After);
      expect(balanceArrakisV1After).to.equal(ethers.constants.Zero);

      contractBalance0 = await token0W.balanceOf(vaultRouter.address);
      contractBalance1 = await token1W.balanceOf(vaultRouter.address);
      contractBalanceG = await rakisTokenW.balanceOf(vaultRouter.address);
      contractBalanceEthEnd = await wallet.provider?.getBalance(
        vaultRouter.address
      );

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalanceG).to.equal(ethers.constants.Zero);
      expect(contractBalanceEth).to.equal(contractBalanceEthEnd);
    });
    it("addLiquidityETHAndStake, removeLiquidityETHAndUnstake", async function () {
      const arrakisWethVault = (await ethers.getContractAt(
        "IArrakisVaultV1",
        addresses.ArrakisV1WethPool
      )) as IArrakisVaultV1;
      const token0W = (await ethers.getContractAt(
        "IERC20",
        await arrakisWethVault.token0()
      )) as IERC20;
      const token1W = (await ethers.getContractAt(
        "IERC20",
        await arrakisWethVault.token1()
      )) as IERC20;
      const rakisTokenW = (await ethers.getContractAt(
        "IERC20",
        addresses.ArrakisV1WethPool
      )) as IERC20;

      expect(await arrakisWethVault.token1()).to.equal(addresses.WETH);

      const gaugeImplFactory = ethers.ContractFactory.fromSolidity(Gauge);
      const gaugeImpl = await gaugeImplFactory
        .connect(wallet)
        .deploy({ gasLimit: 6000000 });
      const encoded = gaugeImpl.interface.encodeFunctionData("initialize", [
        arrakisWethVault.address,
        await wallet.getAddress(),
        ANGLE,
        veANGLE,
        veBoost,
        await wallet.getAddress(),
      ]);
      const factory = await ethers.getContractFactory("EIP173Proxy");
      const contract = await factory
        .connect(wallet)
        .deploy(gaugeImpl.address, await wallet.getAddress(), encoded);
      gauge = await ethers.getContractAt(Gauge.abi, contract.address);
      stRakisToken = (await ethers.getContractAt(
        "IERC20",
        gauge.address
      )) as IERC20;

      await gauge
        .connect(wallet)
        .add_reward(token0.address, await wallet.getAddress(), {
          gasLimit: 6000000,
        });
      await token0
        .connect(wallet)
        .approve(gauge.address, WAD.mul(ethers.BigNumber.from("100")));
      await gauge.deposit_reward_token(
        token0.address,
        WAD.mul(ethers.BigNumber.from("100")),
        { gasLimit: 6000000 }
      );

      // addLiquidityETHAndStake

      await token0W
        .connect(wallet)
        .approve(
          vaultRouterWrapper.address,
          ethers.utils.parseEther("1000000")
        );
      let balance0Before = await token0W.balanceOf(await wallet.getAddress());
      let balance1Before = await wallet.provider?.getBalance(
        await wallet.getAddress()
      );
      let balanceArrakisV1Before = await rakisTokenW.balanceOf(
        await wallet.getAddress()
      );
      let balanceStakedBefore = await stRakisToken.balanceOf(
        await wallet.getAddress()
      );

      const input0 = "100000000";
      const input1 = WAD.mul(ethers.BigNumber.from("2"));
      const addLiquidityData = {
        amount0Max: input0,
        amount1Max: input1,
        amount0Min: 0,
        amount1Min: 0,
        receiver: await wallet.getAddress(),
        useETH: true,
        gaugeAddress: gauge.address,
      };
      await vaultRouterWrapper.addLiquidity(
        arrakisWethVault.address,
        addLiquidityData,
        { value: input1 }
      );

      let balance0After = await token0W.balanceOf(await wallet.getAddress());
      let balance1After = await wallet.provider?.getBalance(
        await wallet.getAddress()
      );
      let balanceArrakisV1After = await rakisTokenW.balanceOf(
        await wallet.getAddress()
      );
      let balanceStakedAfter = await stRakisToken.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0Before).to.be.gt(balance0After);
      expect(balance1Before).to.be.gt(balance1After);
      expect(balanceArrakisV1Before).to.be.eq(balanceArrakisV1After);
      expect(balanceStakedBefore).to.be.lt(balanceStakedAfter);

      let contractBalance0 = await token0W.balanceOf(vaultRouter.address);
      let contractBalance1 = await token1W.balanceOf(vaultRouter.address);
      let contractBalance2 = await rakisTokenW.balanceOf(vaultRouter.address);
      let contractBalance3 = await stRakisToken.balanceOf(vaultRouter.address);
      let contractBalanceEthEnd = await wallet.provider?.getBalance(
        vaultRouter.address
      );

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalance2).to.equal(ethers.constants.Zero);
      expect(contractBalance3).to.equal(ethers.constants.Zero);
      expect(contractBalanceEthEnd).to.equal(contractBalanceEth);

      balance0Before = balance0After;
      balance1Before = balance1After;
      balanceArrakisV1Before = balanceArrakisV1After;
      balanceStakedBefore = balanceStakedAfter;
      const balanceRewardsBefore = await token0.balanceOf(
        await wallet.getAddress()
      );
      const newStartTime1 = (await wallet.provider?.getBlock("latest"))
        ?.timestamp;
      const dayLater1 = Number(newStartTime1?.toString()) + 86400;
      await network.provider.request({
        method: "evm_mine",
        params: [dayLater1],
      });

      const claimable = await gauge.claimable_reward(
        await wallet.getAddress(),
        token0.address
      );
      expect(claimable).to.be.gt(0);

      // removeLiquidityETHAndUnstake

      await stRakisToken.approve(
        vaultRouterWrapper.address,
        balanceStakedBefore
      );
      const removeLiquidity = {
        burnAmount: balanceStakedBefore,
        amount0Min: 0,
        amount1Min: 0,
        receiver: await wallet.getAddress(),
        receiveETH: true,
        gaugeAddress: gauge.address,
      };
      await vaultRouterWrapper.removeLiquidity(
        arrakisWethVault.address,
        removeLiquidity
      );
      balance0After = await token0W.balanceOf(await wallet.getAddress());
      balance1After = await wallet.provider?.getBalance(
        await wallet.getAddress()
      );
      balanceArrakisV1After = await rakisTokenW.balanceOf(
        await wallet.getAddress()
      );
      balanceStakedAfter = await stRakisToken.balanceOf(
        await wallet.getAddress()
      );
      const balanceRewardsAfter = await token0.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0After).to.be.gt(balance0Before);
      expect(balance1After).to.be.gt(balance1Before);
      expect(balanceRewardsAfter).to.be.gt(balanceRewardsBefore);
      expect(balanceArrakisV1Before).to.be.eq(balanceArrakisV1After);
      expect(balanceArrakisV1After).to.equal(ethers.constants.Zero);

      contractBalance0 = await token0W.balanceOf(vaultRouter.address);
      contractBalance1 = await token1W.balanceOf(vaultRouter.address);
      contractBalance2 = await rakisTokenW.balanceOf(vaultRouter.address);
      contractBalance3 = await stRakisToken.balanceOf(vaultRouter.address);
      contractBalanceEthEnd = await wallet.provider?.getBalance(
        vaultRouter.address
      );

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalance2).to.equal(ethers.constants.Zero);
      expect(contractBalance3).to.equal(ethers.constants.Zero);
      expect(contractBalanceEth).to.equal(contractBalanceEthEnd);
    });
  });
  describe("swaps", function () {
    it("should swap and deposit funds", async function () {
      // token0 is DAI
      const spendAmountDAI = ethers.utils.parseUnits("100000", "18");
      const spendAmountUSDC = ethers.utils.parseUnits("100000", "6");
      console.log("spendAmountDAI: ", spendAmountDAI?.toString());
      console.log("spendAmountUSDC: ", spendAmountUSDC?.toString());

      await token0
        .connect(wallet)
        .approve(vaultRouterWrapper.address, spendAmountDAI);
      await token1
        .connect(wallet)
        .approve(vaultRouterWrapper.address, spendAmountUSDC);

      const balance0Before = await token0.balanceOf(await wallet.getAddress());
      const balance1Before = await token1.balanceOf(await wallet.getAddress());
      const balanceRakisBefore = await rakisToken.balanceOf(
        await wallet.getAddress()
      );

      const [amount0Current, amount1Current] =
        await vault.getUnderlyingBalances();
      console.log("amount0Current: ", amount0Current?.toString());
      console.log("amount1Current: ", amount1Current?.toString());

      // amount here is not so important, as what we want is an initial price for this asset pair
      const quoteAmount = await quote1Inch(
        "1",
        addresses.USDC,
        addresses.DAI,
        spendAmountUSDC.toString()
      );
      console.log("quoteAmount: ", quoteAmount);

      const denominator = ethers.BigNumber.from(quoteAmount).mul(
        ethers.BigNumber.from((10 ** 6).toString())
      );
      const numerator = ethers.BigNumber.from(spendAmountDAI.toString()).mul(
        ethers.utils.parseEther("1")
      );
      const priceX18 = numerator
        .mul(ethers.utils.parseEther("1"))
        .div(denominator);
      console.log("price check:", priceX18.toString());

      // given this price and the amounts the user is willing to spend
      // which token should be swapped and how much
      const result = await resolver.getRebalanceParams(
        vault.address,
        spendAmountDAI,
        spendAmountUSDC,
        priceX18
      );
      console.log(
        "getRebalanceParams - result.swapAmount.toString(): ",
        result.swapAmount.toString()
      );
      expect(result.zeroForOne).to.be.false; // this pool has 4.5x more DAI than USDC

      // now that we know how much to swap, let's check what's the price that we get
      const quoteAmount2 = await quote1Inch(
        "1",
        addresses.USDC,
        addresses.DAI,
        result.swapAmount.toString()
      );
      console.log("quoteAmount2:", quoteAmount2);
      const denominator2 = ethers.BigNumber.from(quoteAmount2).mul(
        ethers.BigNumber.from((10 ** 6).toString())
      );
      const numerator2 = result.swapAmount.mul(ethers.utils.parseEther("1"));
      const price2 = numerator2
        .mul(ethers.utils.parseEther("1"))
        .div(denominator2);
      console.log("price2 check:", price2.toString());

      // given the new price, does the swap amount changes?
      const result2 = await resolver.getRebalanceParams(
        vault.address,
        spendAmountDAI,
        spendAmountUSDC.toString(),
        price2
      );
      expect(result2.zeroForOne).to.be.false;
      console.log(
        "getRebalanceParams - result2.swapAmount.toString():",
        result2.swapAmount.toString()
      );
      const quoteAmount3 = await quote1Inch(
        "1",
        addresses.USDC,
        addresses.DAI,
        result2.swapAmount.toString()
      );
      console.log("quoteAmount3:", quoteAmount3);

      const denominator3 = ethers.BigNumber.from(quoteAmount3).mul(
        ethers.BigNumber.from((10 ** 6).toString())
      );
      const numerator3 = result.swapAmount.mul(ethers.utils.parseEther("1"));
      const price3 = numerator3
        .mul(ethers.utils.parseEther("1"))
        .div(denominator3);
      console.log("price3 check:", price3.toString());

      // given the new price, does the swap amount changes?
      const result3 = await resolver.getRebalanceParams(
        vault.address,
        spendAmountDAI,
        spendAmountUSDC.toString(),
        price3
      );
      console.log(
        "getRebalanceParams - result3.swapAmount.toString():",
        result3.swapAmount.toString()
      );
      const amountDAIUse = spendAmountDAI.add(
        ethers.BigNumber.from(quoteAmount3)
      );
      const amountUSDCUse = spendAmountUSDC.sub(result2.swapAmount);
      console.log("amountDAIUse.toString(): ", amountDAIUse.toString());
      console.log("amountUSDCUse.toString() ", amountUSDCUse.toString());
      const mintAmounts = await vault.getMintAmounts(
        amountDAIUse,
        amountUSDCUse
      );
      console.log(
        "mintAmounts.amount0.toString() ",
        mintAmounts.amount0.toString()
      );
      console.log(
        "mintAmounts.amount1.toString() ",
        mintAmounts.amount1.toString()
      );
      console.log(
        "mintAmounts.mintAmount.toString() ",
        mintAmounts.mintAmount.toString()
      );

      const swapParams = await swapTokenData(
        "1",
        addresses.USDC,
        addresses.DAI,
        result2.swapAmount.toString(),
        vaultRouter.address,
        "10"
      );

      const addData = {
        amount0Max: spendAmountDAI,
        amount1Max: spendAmountUSDC,
        amount0Min: 0,
        amount1Min: 0,
        receiver: await wallet.getAddress(),
        useETH: false,
        gaugeAddress: "0x0000000000000000000000000000000000000000",
      };

      const amountOut = ethers.BigNumber.from(quoteAmount3)
        .mul(ethers.BigNumber.from((9).toString()))
        .div(ethers.BigNumber.from((10).toString())); // -10% (slippage protection)
      console.log("amountOut: ", amountOut); // 70740,9

      const swapData = {
        amountInSwap: result2.swapAmount.toString(),
        amountOutSwap: amountOut,
        zeroForOne: result2.zeroForOne,
        swapRouter: swapParams.to,
        swapPayload: swapParams.data,
      };

      await vaultRouterWrapper.swapAndAddLiquidity(
        vault.address,
        addData,
        swapData
      );

      const balance0After = await token0.balanceOf(await wallet.getAddress());
      const balance1After = await token1.balanceOf(await wallet.getAddress());
      const balanceRakisAfter = await rakisToken.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0Before).to.be.gt(balance0After);
      expect(balance1Before).to.be.gt(balance1After);
      expect(balanceRakisBefore).to.be.lt(balanceRakisAfter);

      console.log(
        "DAI input:",
        ethers.utils.formatUnits(balance0Before.sub(balance0After), "18")
      );
      console.log(
        "USDC input:",
        ethers.utils.formatUnits(balance1Before.sub(balance1After), "6")
      );
      console.log(
        "RAKIS minted:",
        balanceRakisBefore.sub(balanceRakisAfter).toString()
      );

      const routerBalance0 = await token0.balanceOf(vaultRouter.address);
      const routerBalance1 = await token1.balanceOf(vaultRouter.address);
      const routerBalanceRakis = await rakisToken.balanceOf(
        vaultRouter.address
      );

      expect(routerBalance0).to.equal(ethers.constants.Zero);
      expect(routerBalance1).to.equal(ethers.constants.Zero);
      expect(routerBalanceRakis).to.equal(ethers.constants.Zero);

      const wrapperBalance0 = await token0.balanceOf(
        vaultRouterWrapper.address
      );
      const wrapperBalance1 = await token1.balanceOf(
        vaultRouterWrapper.address
      );
      const wrapperBalanceRakis = await rakisToken.balanceOf(
        vaultRouterWrapper.address
      );

      expect(wrapperBalance0).to.equal(ethers.constants.Zero);
      expect(wrapperBalance1).to.equal(ethers.constants.Zero);
      expect(wrapperBalanceRakis).to.equal(ethers.constants.Zero);
    });
  });
});
