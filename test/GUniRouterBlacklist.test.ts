import { expect } from "chai";
import { deployments, ethers, network } from "hardhat";
import {
  IERC20,
  GUniRouterBlacklist,
  IGUniPool,
  IUniswapV3Pool,
  GUniResolver,
} from "../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { Addresses, getAddresses } from "../src/addresses";

let addresses: Addresses;

const X96 = ethers.BigNumber.from("2").pow("96");
const WAD = ethers.BigNumber.from("10").pow("18");

describe("G-UNI Router (with Blacklist) tests", function () {
  this.timeout(0);
  let wallet: SignerWithAddress;
  let token0: IERC20;
  let token1: IERC20;
  let gUniToken: IERC20;
  let gUniPool: IGUniPool;
  let gUniRouter: GUniRouterBlacklist;
  let pool: IUniswapV3Pool;
  let resolver: GUniResolver;
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
      ["function getGelatoPools() external view returns(address[] memory)"],
      addresses.GUniFactory
    );
    const pools = await gUniFactory.getGelatoPools();
    const poolAddress = pools[0];
    gUniPool = (await ethers.getContractAt(
      "IGUniPool",
      poolAddress
    )) as IGUniPool;
    token0 = (await ethers.getContractAt(
      "IERC20",
      await gUniPool.token0()
    )) as IERC20;
    token1 = (await ethers.getContractAt(
      "IERC20",
      await gUniPool.token1()
    )) as IERC20;
    gUniToken = (await ethers.getContractAt("IERC20", poolAddress)) as IERC20;

    pool = (await ethers.getContractAt(
      "IUniswapV3Pool",
      await gUniPool.pool()
    )) as IUniswapV3Pool;

    const gUniRouterAddress = (await deployments.get("GUniRouterBlacklist"))
      .address;

    gUniRouter = (await ethers.getContractAt(
      "GUniRouterBlacklist",
      gUniRouterAddress
    )) as GUniRouterBlacklist;

    const resolverAddress = (await deployments.get("GUniResolver")).address;

    resolver = (await ethers.getContractAt(
      "GUniResolver",
      resolverAddress
    )) as GUniResolver;

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

  describe("deposits through GUniRouter", function () {
    it("should deposit funds with addLiquidity", async function () {
      await token0
        .connect(wallet)
        .approve(gUniRouter.address, ethers.utils.parseEther("1000000"));
      await token1
        .connect(wallet)
        .approve(gUniRouter.address, ethers.utils.parseEther("100000"));
      const balance0Before = await token0.balanceOf(await wallet.getAddress());
      const balance1Before = await token1.balanceOf(await wallet.getAddress());
      const balanceGUniBefore = await gUniToken.balanceOf(
        await wallet.getAddress()
      );

      const input0 = WAD.mul(ethers.BigNumber.from("100"));
      const input1 = "100000000";

      await gUniRouter.addLiquidity(
        gUniPool.address,
        input0,
        input1,
        0,
        0,
        await wallet.getAddress()
      );
      const balance0After = await token0.balanceOf(await wallet.getAddress());
      const balance1After = await token1.balanceOf(await wallet.getAddress());
      const balanceGUniAfter = await gUniToken.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0Before).to.be.gt(balance0After);
      expect(balance1Before).to.be.gt(balance1After);
      expect(balanceGUniBefore).to.be.lt(balanceGUniAfter);

      const contractBalance0 = await token0.balanceOf(gUniRouter.address);
      const contractBalance1 = await token1.balanceOf(gUniRouter.address);
      const contractBalanceG = await gUniToken.balanceOf(gUniRouter.address);

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalanceG).to.equal(ethers.constants.Zero);
    });

    it("should deposit funds with rebalanceAndAddLiquidity", async function () {
      await token0
        .connect(wallet)
        .approve(gUniRouter.address, ethers.utils.parseEther("1000000"));
      await token1
        .connect(wallet)
        .approve(gUniRouter.address, ethers.utils.parseEther("100000"));
      const balance0Before = await token0.balanceOf(await wallet.getAddress());
      const balance1Before = await token1.balanceOf(await wallet.getAddress());
      const balanceGUniBefore = await gUniToken.balanceOf(
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
          gUniPool.address,
          input0,
          input1,
          normalized.toString()
        );

      await gUniRouter.rebalanceAndAddLiquidity(
        gUniPool.address,
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
      const balanceGUniAfter = await gUniToken.balanceOf(
        await wallet.getAddress()
      );
      expect(balance0Before).to.be.gt(balance0After);
      expect(balance1Before).to.be.gt(balance1After);
      expect(balanceGUniBefore).to.be.lt(balanceGUniAfter);

      const contractBalance0 = await token0.balanceOf(gUniRouter.address);
      const contractBalance1 = await token1.balanceOf(gUniRouter.address);
      const contractBalanceG = await gUniToken.balanceOf(gUniRouter.address);

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalanceG).to.equal(ethers.constants.Zero);
    });
  });
  describe("withdrawal through GUniRouter", function () {
    it("should withdraw funds with removeLiquidity", async function () {
      const balanceGUniBefore = await gUniToken.balanceOf(
        await wallet.getAddress()
      );
      expect(balanceGUniBefore).to.be.gt(ethers.constants.Zero);
      const balance0Before = await token0.balanceOf(await wallet.getAddress());
      const balance1Before = await token1.balanceOf(await wallet.getAddress());
      await gUniToken.approve(
        gUniRouter.address,
        ethers.utils.parseEther("100000000")
      );
      await gUniRouter.removeLiquidity(
        gUniPool.address,
        balanceGUniBefore,
        0,
        0,
        await wallet.getAddress()
      );
      const balance0After = await token0.balanceOf(await wallet.getAddress());
      const balance1After = await token1.balanceOf(await wallet.getAddress());
      const balanceGUniAfter = await gUniToken.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0After).to.be.gt(balance0Before);
      expect(balance1After).to.be.gt(balance1Before);
      expect(balanceGUniBefore).to.be.gt(balanceGUniAfter);
    });
  });
  describe("ETH methods", function () {
    it("addLiquidityETH, rebalanceAndAddLiquidityETH, removeLiquidityETH", async function () {
      const gUniWethPool = (await ethers.getContractAt(
        "IGUniPool",
        addresses.GUniWethPool
      )) as IGUniPool;
      const token0W = (await ethers.getContractAt(
        "IERC20",
        await gUniWethPool.token0()
      )) as IERC20;
      const token1W = (await ethers.getContractAt(
        "IERC20",
        await gUniWethPool.token1()
      )) as IERC20;
      const gUniTokenW = (await ethers.getContractAt(
        "IERC20",
        addresses.GUniWethPool
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
        .approve(gUniRouter.address, ethers.utils.parseEther("1000000"));
      let balance0Before = await token0W.balanceOf(await wallet.getAddress());
      let balance1Before = await wallet.provider?.getBalance(
        await wallet.getAddress()
      );
      let balanceGUniBefore = await gUniTokenW.balanceOf(
        await wallet.getAddress()
      );

      const input0 = "100000000";
      const input1 = WAD.mul(ethers.BigNumber.from("1"));

      await gUniRouter.addLiquidityETH(
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
      let balanceGUniAfter = await gUniTokenW.balanceOf(
        await wallet.getAddress()
      );

      expect(balance0Before).to.be.gt(balance0After);
      expect(balance1Before).to.be.gt(balance1After);
      expect(balanceGUniBefore).to.be.lt(balanceGUniAfter);

      let contractBalance0 = await token0W.balanceOf(gUniRouter.address);
      let contractBalance1 = await token1W.balanceOf(gUniRouter.address);
      let contractBalanceG = await gUniTokenW.balanceOf(gUniRouter.address);
      let contractBalanceEth = await wallet.provider?.getBalance(
        gUniRouter.address
      );

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalanceG).to.equal(ethers.constants.Zero);
      expect(contractBalanceEth).to.equal(ethers.constants.Zero);

      balance0Before = balance0After;
      balance1Before = balance1After;
      balanceGUniBefore = balanceGUniAfter;

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

      await gUniRouter.rebalanceAndAddLiquidityETH(
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
      balanceGUniAfter = await gUniTokenW.balanceOf(await wallet.getAddress());
      expect(balance0Before).to.be.gt(balance0After);
      expect(balance1Before).to.be.gt(balance1After);
      expect(balanceGUniBefore).to.be.lt(balanceGUniAfter);

      contractBalance0 = await token0W.balanceOf(gUniRouter.address);
      contractBalance1 = await token1W.balanceOf(gUniRouter.address);
      contractBalanceG = await gUniTokenW.balanceOf(gUniRouter.address);
      contractBalanceEth = await wallet.provider?.getBalance(
        gUniRouter.address
      );

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalanceG).to.equal(ethers.constants.Zero);
      expect(contractBalanceEth).to.equal(ethers.constants.Zero);

      balance0Before = balance0After;
      balance1Before = balance1After;
      balanceGUniBefore = balanceGUniAfter;

      // removeLiquidityETH

      await gUniTokenW.approve(gUniRouter.address, balanceGUniBefore);
      await gUniRouter.removeLiquidityETH(
        gUniWethPool.address,
        balanceGUniBefore,
        0,
        0,
        await wallet.getAddress()
      );
      balance0After = await token0.balanceOf(await wallet.getAddress());
      balance1After = await wallet.provider?.getBalance(
        await wallet.getAddress()
      );
      balanceGUniAfter = await gUniToken.balanceOf(await wallet.getAddress());

      expect(balance0After).to.be.gt(balance0Before);
      expect(balance1After).to.be.gt(balance1Before);
      expect(balanceGUniBefore).to.be.gt(balanceGUniAfter);
      expect(balanceGUniAfter).to.equal(ethers.constants.Zero);

      contractBalance0 = await token0W.balanceOf(gUniRouter.address);
      contractBalance1 = await token1W.balanceOf(gUniRouter.address);
      contractBalanceG = await gUniTokenW.balanceOf(gUniRouter.address);
      contractBalanceEth = await wallet.provider?.getBalance(
        gUniRouter.address
      );

      expect(contractBalance0).to.equal(ethers.constants.Zero);
      expect(contractBalance1).to.equal(ethers.constants.Zero);
      expect(contractBalanceG).to.equal(ethers.constants.Zero);
      expect(contractBalanceEth).to.equal(ethers.constants.Zero);
    });
  });
});
