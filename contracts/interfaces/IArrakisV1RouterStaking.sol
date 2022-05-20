// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;

import {IArrakisVaultV1} from "./IArrakisVaultV1.sol";
import {IGauge} from "./IGauge.sol";

interface IArrakisV1RouterStaking {
    function addLiquidity(
        IArrakisVaultV1 pool,
        uint256 amount0Max,
        uint256 amount1Max,
        uint256 amount0Min,
        uint256 amount1Min,
        address receiver,
        bool useETH,
        address gaugeAddress
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
}
