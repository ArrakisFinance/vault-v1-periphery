// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.13;

import {IArrakisVaultV1} from "./IArrakisVaultV1.sol";
import {
    AddLiquidityData,
    MintData,
    RemoveLiquidityData,
    AddAndSwapData
} from "./IArrakisV1Router.sol";

interface IArrakisV1RouterWrapper {
    function addLiquidity(AddLiquidityData memory _addData)
        external
        payable
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        );

    function removeLiquidity(RemoveLiquidityData memory _removeData)
        external
        returns (
            uint256 amount0,
            uint256 amount1,
            uint128 liquidityBurned
        );

    function swapAndAddLiquidity(AddAndSwapData memory _addData)
        external
        payable
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount,
            uint256 amount0Diff,
            uint256 amount1Diff
        );
}
