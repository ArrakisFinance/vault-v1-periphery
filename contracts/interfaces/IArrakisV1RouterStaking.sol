// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;

import {IArrakisVaultV1} from "./IArrakisVaultV1.sol";
import {IGauge} from "./IGauge.sol";

struct AddLiquidityData {
    // maximum amount of token0 to forward on mint
    uint256 amount0Max;
    // maximum amount of token1 to forward on mint
    uint256 amount1Max;
    // the minimum amount of token0 actually deposited (slippage protection)
    uint256 amount0Min;
    // the minimum amount of token1 actually deposited (slippage protection)
    uint256 amount1Min;
    // account to receive minted tokens
    address receiver;
    // bool indicating to use native ETH
    bool useETH;
    // address of gauge to stake tokens in
    address gaugeAddress;
}

struct SwapData {
    // max amount being swapped
    uint256 amountInSwap;
    // min amount received on swap
    uint256 amountOutSwap;
    // bool indicating swap direction
    bool zeroForOne;
    // address for swap calls
    address swapRouter;
    // payload for swap call
    bytes[] swapPayload;
}

interface IArrakisV1RouterStaking {
    function addLiquidity(
        IArrakisVaultV1 pool,
        AddLiquidityData memory _addData
    )
        external
        payable
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        );

    function removeLiquidity(
        IArrakisVaultV1 pool,
        uint256 burnAmount,
        uint256 amount0Min,
        uint256 amount1Min,
        address payable receiver,
        bool receiveETH,
        address gaugeAddress
    )
        external
        returns (
            uint256 amount0,
            uint256 amount1,
            uint128 liquidityBurned
        );

    function swapAndAddLiquidity(
        IArrakisVaultV1 pool,
        AddLiquidityData memory _addData,
        SwapData memory _swapData
    )
        external
        payable
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        );
}
