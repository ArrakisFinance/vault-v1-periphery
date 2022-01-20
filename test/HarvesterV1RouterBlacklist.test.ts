import { expect } from "chai";
import { deployments, ethers, network } from "hardhat";
import {
  IERC20,
  HarvesterV1RouterBlacklist,
  IHarvesterV1,
  IUniswapV3Pool,
  HarvesterV1Resolver,
} from "../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { Addresses, getAddresses } from "../src/addresses";

let addresses: Addresses;

const X96 = ethers.BigNumber.from("2").pow("96");
const WAD = ethers.BigNumber.from("10").pow("18");

describe("HarvesterV1 Router (with Blacklist) tests", function () {
  this.timeout(0);
  let wallet: SignerWithAddress;
  let token0: IERC20;
  let token1: IERC20;
  let rakisToken: IERC20;
  let harvesterV1: IHarvesterV1;
  let harvesterV1Router: HarvesterV1RouterBlacklist;
  let pool: IUniswapV3Pool;
  let resolver: HarvesterV1Resolver;
  let decimals0: number;
  let decimals1: number;
  before(async function () {
    await deployments.fixture();

    addresses = getAddresses(network.name);
    [wallet] = await ethers.getSigners();

    const faucet = "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7";

    await network.provider.send("hardhat_setBalance", [
      faucet,
      "0x313030303030303030303030303030303030303030",
    ]);
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
    token0 = (await ethers.getContractAt(
      "IERC20",
      await harvesterV1.token0()
    )) as IERC20;
    token1 = (await ethers.getContractAt(
      "IERC20",
      await harvesterV1.token1()
    )) as IERC20;
    rakisToken = (await ethers.getContractAt("IERC20", poolAddress)) as IERC20;

    pool = (await ethers.getContractAt(
      "IUniswapV3Pool",
      await harvesterV1.pool()
    )) as IUniswapV3Pool;

    const harvesterV1RouterAddress = (
      await deployments.get("HarvesterV1RouterBlacklist")
    ).address;

    harvesterV1Router = (await ethers.getContractAt(
      "HarvesterV1RouterBlacklist",
      harvesterV1RouterAddress
    )) as HarvesterV1RouterBlacklist;

    const resolverAddress = (await deployments.get("HarvesterV1Resolver"))
      .address;

    resolver = (await ethers.getContractAt(
      "HarvesterV1Resolver",
      resolverAddress
    )) as HarvesterV1Resolver;

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

    decimals0 = Number(
      await (
        await ethers.getContractAt(
          ["function decimals() external view returns(uint8)"],
          token0.address
        )
      ).decimals()
    );
    decimals1 = Number(
      await (
        await ethers.getContractAt(
          ["function decimals() external view returns(uint8)"],
          token1.address
        )
      ).decimals()
    );
  });

  describe("deposits through HarvesterV1Router", function () {
    it("should deposit funds with addLiquidity", async function () {
      await token0
        .connect(wallet)
        .approve(harvesterV1Router.address, ethers.utils.parseEther("1000000"));
      await token1
        .connect(wallet)
        .approve(harvesterV1Router.address, ethers.utils.parseEther("100000"));
      const balance0Before = await token0.balanceOf(await wallet.getAddress());
      const balance1Before = await token1.balanceOf(await wallet.getAddress());
      const balanceHarvesterV1Before = await rakisToken.balanceOf(
        await wallet.getAddress()
      );

      const input0 = WAD.mul(ethers.BigNumber.from("100"));
      const input1 = "100000000";

      await harvesterV1Router.addLiquidity(
        harvesterV1.address,
        input0,
        input1,
        0,
        0,
        await wallet.getAddress()
      );
      const balance0After = await token0.balanceOf(await wallet.getAddress());
      const balance1After = await token1.balanceOf(await wallet.getAddress());
      const balanceHarvesterV1After = await rakisToken.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0Before).to.be.gt(balance0After);
      expect(balance1Before).to.be.gt(balance1After);
      expect(balanceHarvesterV1Before).to.be.lt(balanceHarvesterV1After);

      const contractBalance0 = await token0.balanceOf(
        harvesterV1Router.address
      );
      const contractBalance1 = await token1.balanceOf(
        harvesterV1Router.address
      );
      const contractBalanceG = await rakisToken.balanceOf(
        harvesterV1Router.address
      );

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalanceG).to.equal(ethers.constants.Zero);
    });

    it("should deposit funds with rebalanceAndAddLiquidity", async function () {
      await token0
        .connect(wallet)
        .approve(harvesterV1Router.address, ethers.utils.parseEther("1000000"));
      await token1
        .connect(wallet)
        .approve(harvesterV1Router.address, ethers.utils.parseEther("100000"));
      const balance0Before = await token0.balanceOf(await wallet.getAddress());
      const balance1Before = await token1.balanceOf(await wallet.getAddress());
      const balanceHarvesterV1Before = await rakisToken.balanceOf(
        await wallet.getAddress()
      );

      const input0 = WAD.mul(ethers.BigNumber.from("100"));
      const input1 = "100000000";

      const { sqrtPriceX96 } = await pool.slot0();

      const priceX96 = sqrtPriceX96.mul(sqrtPriceX96).div(X96);
      const normalized = priceX96
        .mul(ethers.BigNumber.from((10 ** decimals0).toString()))
        .mul(WAD)
        .div(ethers.BigNumber.from((10 ** decimals1).toString()))
        .div(X96);

      const { zeroForOne: isZero, swapAmount } =
        await resolver.getRebalanceParams(
          harvesterV1.address,
          input0,
          input1,
          normalized.toString()
        );

      await harvesterV1Router.rebalanceAndAddLiquidity(
        harvesterV1.address,
        input0,
        input1,
        isZero,
        swapAmount,
        isZero
          ? sqrtPriceX96.div(ethers.BigNumber.from("100"))
          : sqrtPriceX96.mul(ethers.BigNumber.from("100")),
        0,
        0,
        await wallet.getAddress()
      );

      const balance0After = await token0.balanceOf(await wallet.getAddress());
      const balance1After = await token1.balanceOf(await wallet.getAddress());
      const balanceHarvesterV1After = await rakisToken.balanceOf(
        await wallet.getAddress()
      );
      expect(balance0Before).to.be.gt(balance0After);
      expect(balance1Before).to.be.gt(balance1After);
      expect(balanceHarvesterV1Before).to.be.lt(balanceHarvesterV1After);

      const contractBalance0 = await token0.balanceOf(
        harvesterV1Router.address
      );
      const contractBalance1 = await token1.balanceOf(
        harvesterV1Router.address
      );
      const contractBalanceG = await rakisToken.balanceOf(
        harvesterV1Router.address
      );

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalanceG).to.equal(ethers.constants.Zero);
    });
  });
  describe("withdrawal through HarvesterV1Router", function () {
    it("should withdraw funds with removeLiquidity", async function () {
      const balanceHarvesterV1Before = await rakisToken.balanceOf(
        await wallet.getAddress()
      );
      expect(balanceHarvesterV1Before).to.be.gt(ethers.constants.Zero);
      const balance0Before = await token0.balanceOf(await wallet.getAddress());
      const balance1Before = await token1.balanceOf(await wallet.getAddress());
      await rakisToken.approve(
        harvesterV1Router.address,
        ethers.utils.parseEther("100000000")
      );
      await harvesterV1Router.removeLiquidity(
        harvesterV1.address,
        balanceHarvesterV1Before,
        0,
        0,
        await wallet.getAddress()
      );
      const balance0After = await token0.balanceOf(await wallet.getAddress());
      const balance1After = await token1.balanceOf(await wallet.getAddress());
      const balanceHarvesterV1After = await rakisToken.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0After).to.be.gt(balance0Before);
      expect(balance1After).to.be.gt(balance1Before);
      expect(balanceHarvesterV1Before).to.be.gt(balanceHarvesterV1After);
    });
  });
  describe("ETH methods", function () {
    it("addLiquidityETH, rebalanceAndAddLiquidityETH, removeLiquidityETH", async function () {
      const gUniWethPool = (await ethers.getContractAt(
        "IHarvesterV1",
        addresses.HarvesterV1WethPool
      )) as IHarvesterV1;
      const token0W = (await ethers.getContractAt(
        "IERC20",
        await gUniWethPool.token0()
      )) as IERC20;
      const token1W = (await ethers.getContractAt(
        "IERC20",
        await gUniWethPool.token1()
      )) as IERC20;
      const rakisTokenW = (await ethers.getContractAt(
        "IERC20",
        addresses.HarvesterV1WethPool
      )) as IERC20;
      const decimals0W = Number(
        await (
          await ethers.getContractAt(
            ["function decimals() external view returns(uint8)"],
            token0W.address
          )
        ).decimals()
      );
      const decimals1W = Number(
        await (
          await ethers.getContractAt(
            ["function decimals() external view returns(uint8)"],
            token1W.address
          )
        ).decimals()
      );

      const poolW = (await ethers.getContractAt(
        "IUniswapV3Pool",
        await gUniWethPool.pool()
      )) as IUniswapV3Pool;

      expect(await gUniWethPool.token1()).to.equal(addresses.WETH);

      // addLiquidityETH

      await token0W
        .connect(wallet)
        .approve(harvesterV1Router.address, ethers.utils.parseEther("1000000"));
      let balance0Before = await token0W.balanceOf(await wallet.getAddress());
      let balance1Before = await wallet.provider?.getBalance(
        await wallet.getAddress()
      );
      let balanceHarvesterV1Before = await rakisTokenW.balanceOf(
        await wallet.getAddress()
      );

      const input0 = "100000000";
      const input1 = WAD.mul(ethers.BigNumber.from("1"));

      await harvesterV1Router.addLiquidityETH(
        gUniWethPool.address,
        input0,
        input1,
        0,
        0,
        await wallet.getAddress(),
        { value: input1 }
      );

      let balance0After = await token0W.balanceOf(await wallet.getAddress());
      let balance1After = await wallet.provider?.getBalance(
        await wallet.getAddress()
      );
      let balanceHarvesterV1After = await rakisTokenW.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0Before).to.be.gt(balance0After);
      expect(balance1Before).to.be.gt(balance1After);
      expect(balanceHarvesterV1Before).to.be.lt(balanceHarvesterV1After);

      let contractBalance0 = await token0W.balanceOf(harvesterV1Router.address);
      let contractBalance1 = await token1W.balanceOf(harvesterV1Router.address);
      let contractBalanceG = await rakisTokenW.balanceOf(
        harvesterV1Router.address
      );
      let contractBalanceEth = await wallet.provider?.getBalance(
        harvesterV1Router.address
      );

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalanceG).to.equal(ethers.constants.Zero);
      expect(contractBalanceEth).to.equal(ethers.constants.Zero);

      balance0Before = balance0After;
      balance1Before = balance1After;
      balanceHarvesterV1Before = balanceHarvesterV1After;

      // rebalanceAndAddLiquidityETH

      const { sqrtPriceX96 } = await poolW.slot0();

      const priceX96 = sqrtPriceX96.mul(sqrtPriceX96).div(X96);
      const normalized = priceX96
        .mul(ethers.BigNumber.from((10 ** decimals0W).toString()))
        .mul(WAD)
        .div(ethers.BigNumber.from((10 ** decimals1W).toString()))
        .div(X96);

      const { zeroForOne: isZero, swapAmount } =
        await resolver.getRebalanceParams(
          gUniWethPool.address,
          input0,
          input1,
          normalized.toString()
        );

      await harvesterV1Router.rebalanceAndAddLiquidityETH(
        gUniWethPool.address,
        input0,
        input1,
        isZero,
        swapAmount,
        isZero
          ? sqrtPriceX96.div(ethers.BigNumber.from("100"))
          : sqrtPriceX96.mul(ethers.BigNumber.from("100")),
        0,
        0,
        await wallet.getAddress(),
        { value: input1 }
      );

      balance0After = await token0W.balanceOf(await wallet.getAddress());
      balance1After = await wallet.provider?.getBalance(
        await wallet.getAddress()
      );
      balanceHarvesterV1After = await rakisTokenW.balanceOf(
        await wallet.getAddress()
      );
      expect(balance0Before).to.be.gt(balance0After);
      expect(balance1Before).to.be.gt(balance1After);
      expect(balanceHarvesterV1Before).to.be.lt(balanceHarvesterV1After);

      contractBalance0 = await token0W.balanceOf(harvesterV1Router.address);
      contractBalance1 = await token1W.balanceOf(harvesterV1Router.address);
      contractBalanceG = await rakisTokenW.balanceOf(harvesterV1Router.address);
      contractBalanceEth = await wallet.provider?.getBalance(
        harvesterV1Router.address
      );

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalanceG).to.equal(ethers.constants.Zero);
      expect(contractBalanceEth).to.equal(ethers.constants.Zero);

      balance0Before = balance0After;
      balance1Before = balance1After;
      balanceHarvesterV1Before = balanceHarvesterV1After;

      // removeLiquidityETH

      await rakisTokenW.approve(
        harvesterV1Router.address,
        balanceHarvesterV1Before
      );
      await harvesterV1Router.removeLiquidityETH(
        gUniWethPool.address,
        balanceHarvesterV1Before,
        0,
        0,
        await wallet.getAddress()
      );
      balance0After = await token0.balanceOf(await wallet.getAddress());
      balance1After = await wallet.provider?.getBalance(
        await wallet.getAddress()
      );
      balanceHarvesterV1After = await rakisToken.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0After).to.be.gt(balance0Before);
      expect(balance1After).to.be.gt(balance1Before);
      expect(balanceHarvesterV1Before).to.be.gt(balanceHarvesterV1After);
      expect(balanceHarvesterV1After).to.equal(ethers.constants.Zero);

      contractBalance0 = await token0W.balanceOf(harvesterV1Router.address);
      contractBalance1 = await token1W.balanceOf(harvesterV1Router.address);
      contractBalanceG = await rakisTokenW.balanceOf(harvesterV1Router.address);
      contractBalanceEth = await wallet.provider?.getBalance(
        harvesterV1Router.address
      );

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalanceG).to.equal(ethers.constants.Zero);
      expect(contractBalanceEth).to.equal(ethers.constants.Zero);
    });
  });
});
