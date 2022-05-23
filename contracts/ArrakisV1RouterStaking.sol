// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;

import {
    IGauge,
    IArrakisV1RouterStaking,
    AddLiquidityData,
    SwapData
} from "./interfaces/IArrakisV1RouterStaking.sol";
import {IArrakisVaultV1} from "./interfaces/IArrakisVaultV1.sol";
import {IWETH} from "./interfaces/IWETH.sol";
import {
    IERC20,
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {
    Initializable
} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
    PausableUpgradeable
} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {GelatoBytes} from "./vendor/gelato/GelatoBytes.sol";

contract ArrakisV1RouterStaking is
    IArrakisV1RouterStaking,
    Initializable,
    PausableUpgradeable,
    OwnableUpgradeable
{
    using Address for address payable;
    using SafeERC20 for IERC20;

    IWETH public immutable weth;

    constructor(IWETH _weth) {
        weth = _weth;
    }

    function initialize() external initializer {
        __Pausable_init();
        __Ownable_init();
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice addLiquidity adds liquidity to ArrakisVaultV1 pool of interest (mints LP tokens)
    /// @param pool address of ArrakisVaultV1 pool to add liquidity to
    /// @param _addData AddLiquidityData struct containing data for adding liquidity
    /// @return amount0 amount of token0 transferred from msg.sender to mint `mintAmount`
    /// @return amount1 amount of token1 transferred from msg.sender to mint `mintAmount`
    /// @return mintAmount amount of ArrakisVaultV1 tokens minted and transferred to `receiver`
    // solhint-disable-next-line function-max-lines
    function addLiquidity(
        IArrakisVaultV1 pool,
        AddLiquidityData memory _addData
    )
        external
        payable
        override
        whenNotPaused
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        )
    {
        if (_addData.gaugeAddress != address(0)) {
            require(
                address(pool) == IGauge(_addData.gaugeAddress).staking_token(),
                "Incorrect gauge!"
            );

            (amount0, amount1, mintAmount) = _addLiquidity(
                pool,
                _addData.amount0Max,
                _addData.amount1Max,
                _addData.amount0Min,
                _addData.amount1Min,
                address(this),
                _addData.useETH
            );

            IERC20(address(pool)).safeIncreaseAllowance(
                _addData.gaugeAddress,
                mintAmount
            );
            IGauge(_addData.gaugeAddress).deposit(
                mintAmount,
                _addData.receiver
            );
        } else {
            (amount0, amount1, mintAmount) = _addLiquidity(
                pool,
                _addData.amount0Max,
                _addData.amount1Max,
                _addData.amount0Min,
                _addData.amount1Min,
                _addData.receiver,
                _addData.useETH
            );
        }
    }

    /// @notice removeLiquidity removes liquidity from a ArrakisVaultV1 pool and burns LP tokens
    /// @param burnAmount The number of ArrakisVaultV1 tokens to burn
    /// @param amount0Min Minimum amount of token0 received after burn (slippage protection)
    /// @param amount1Min Minimum amount of token1 received after burn (slippage protection)
    /// @param receiver The account to receive the underlying amounts of token0 and token1
    /// @param receiveETH bool indicating to use native ETH
    /// @param gaugeAddress address of gauge to unstake from (if 0, don't unstake)
    /// @return amount0 actual amount of token0 transferred to receiver for burning `burnAmount`
    /// @return amount1 actual amount of token1 transferred to receiver for burning `burnAmount`
    /// @return liquidityBurned amount of liquidity removed from the underlying Uniswap V3 position
    // solhint-disable-next-line code-complexity, function-max-lines
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
        override
        whenNotPaused
        returns (
            uint256 amount0,
            uint256 amount1,
            uint128 liquidityBurned
        )
    {
        if (gaugeAddress != address(0)) {
            require(
                address(pool) == IGauge(gaugeAddress).staking_token(),
                "Incorrect gauge!"
            );
            IGauge(gaugeAddress).claim_rewards(msg.sender);
        }
        (amount0, amount1, liquidityBurned) = _removeLiquidity(
            pool,
            burnAmount,
            amount0Min,
            amount1Min,
            receiver,
            receiveETH,
            gaugeAddress
        );
    }

    // solhint-disable-next-line max-line-length
    /// @notice swapAndAddLiquidity makes a swap and deposits to an ArrakisVaultV1 pool and mints LP tokens
    /// @param pool The ArrakisVaultV1 pool
    /// @param _addData struct AddLiquidityData containing data for adding liquidity
    /// @param _addData struct SwapData containing data for swap
    /// @return amount0 amount of token0 transferred from msg.sender to mint `mintAmount`
    /// @return amount1 amount of token1 transferred from msg.sender to mint `mintAmount`
    /// @return mintAmount amount of ArrakisVaultV1 tokens minted and transferred to `receiver`
    // solhint-disable-next-line code-complexity, function-max-lines
    function swapAndAddLiquidity(
        IArrakisVaultV1 pool,
        AddLiquidityData memory _addData,
        SwapData memory _swapData
    )
        external
        payable
        override
        whenNotPaused
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        )
    {
        // amount0Max && amount1Max are already in this contract when this function is called.
        // TODO: might need to add param "address sender" so we can send unused tokens back
        // TODO: should we validate msg.sender here? it should be equal to ArrakisV1SwapProxy
        if (_addData.gaugeAddress != address(0)) {
            require(
                address(pool) == IGauge(_addData.gaugeAddress).staking_token(),
                "Incorrect gauge!"
            );
        }
        uint256 ethValue;
        bool isToken0Weth;
        if (_addData.useETH) {
            isToken0Weth = _isToken0Weth(
                address(pool.token0()),
                address(pool.token1())
            );
            ethValue = (_swapData.zeroForOne == isToken0Weth)
                ? _swapData.amountInSwap
                : 0;
        }
        (uint256 amount0Use, uint256 amount1Use) =
            _swap(
                pool,
                _swapData,
                _addData.amount0Max,
                _addData.amount1Max,
                ethValue
            );

        uint256 _mintAmount;
        (amount0, amount1, _mintAmount) = pool.getMintAmounts(
            amount0Use,
            amount1Use
        );

        require(
            amount0 >= _addData.amount0Min && amount1 >= _addData.amount1Min,
            "below min amounts"
        );

        if (_addData.useETH) {
            if (isToken0Weth) {
                weth.deposit{value: amount0}();
            } else {
                weth.deposit{value: amount1}();
            }
        }

        if (_addData.gaugeAddress != address(0)) {
            (amount0, amount1, mintAmount) = _deposit(
                pool,
                amount0,
                amount1,
                _mintAmount,
                address(this)
            );

            IERC20(address(pool)).safeIncreaseAllowance(
                _addData.gaugeAddress,
                mintAmount
            );
            IGauge(_addData.gaugeAddress).deposit(
                mintAmount,
                _addData.receiver
            );
        } else {
            (amount0, amount1, mintAmount) = _deposit(
                pool,
                amount0,
                amount1,
                _mintAmount,
                _addData.receiver
            );
        }

        // if (_addData.useETH) {
        //     if (isToken0Weth && _addData.amount0Max > amount0) {
        //         payable(msg.sender).sendValue(_addData.amount0Max - amount0);
        //     } else if (!isToken0Weth && _addData.amount1Max > amount1) {
        //         payable(msg.sender).sendValue(_addData.amount1Max - amount1);
        //     }
        // }
    }

    // solhint-disable-next-line code-complexity, function-max-lines
    function _addLiquidity(
        IArrakisVaultV1 pool,
        uint256 amount0Max,
        uint256 amount1Max,
        uint256 amount0Min,
        uint256 amount1Min,
        address receiver,
        bool useETH
    )
        internal
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        )
    {
        IERC20 token0 = pool.token0();
        IERC20 token1 = pool.token1();
        uint256 _mintAmount;
        (amount0, amount1, _mintAmount) = pool.getMintAmounts(
            amount0Max,
            amount1Max
        );
        require(
            amount0 >= amount0Min && amount1 >= amount1Min,
            "below min amounts"
        );

        bool isToken0Weth;
        if (useETH) {
            isToken0Weth = _isToken0Weth(address(token0), address(token1));
            require(
                (isToken0Weth && amount0Max == msg.value) ||
                    (!isToken0Weth && amount1Max == msg.value),
                "mismatching amount of ETH forwarded"
            );
            if (isToken0Weth && amount0 > 0) {
                weth.deposit{value: amount0}();
            }
            if (!isToken0Weth && amount1 > 0) {
                weth.deposit{value: amount1}();
            }
        }
        if (amount0 > 0 && (!useETH || (useETH && !isToken0Weth))) {
            token0.safeTransferFrom(msg.sender, address(this), amount0);
        }
        if (amount1 > 0 && (!useETH || (useETH && isToken0Weth))) {
            token1.safeTransferFrom(msg.sender, address(this), amount1);
        }

        (amount0, amount1, mintAmount) = _deposit(
            pool,
            amount0,
            amount1,
            _mintAmount,
            receiver
        );

        if (useETH) {
            if (isToken0Weth && amount0Max > amount0) {
                payable(msg.sender).sendValue(amount0Max - amount0);
            } else if (!isToken0Weth && amount1Max > amount1) {
                payable(msg.sender).sendValue(amount1Max - amount1);
            }
        }
    }

    function _deposit(
        IArrakisVaultV1 pool,
        uint256 amount0In,
        uint256 amount1In,
        uint256 _mintAmount,
        address receiver
    )
        internal
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        )
    {
        if (amount0In > 0) {
            pool.token0().safeIncreaseAllowance(address(pool), amount0In);
        }
        if (amount1In > 0) {
            pool.token1().safeIncreaseAllowance(address(pool), amount1In);
        }

        (amount0, amount1, ) = pool.mint(_mintAmount, receiver);
        require(
            amount0 == amount0In && amount1 == amount1In,
            "unexpected amounts deposited"
        );
        mintAmount = _mintAmount;
    }

    // solhint-disable-next-line function-max-lines
    function _removeLiquidity(
        IArrakisVaultV1 pool,
        uint256 burnAmount,
        uint256 amount0Min,
        uint256 amount1Min,
        address payable receiver,
        bool receiveETH,
        address gaugeAddress
    )
        internal
        returns (
            uint256 amount0,
            uint256 amount1,
            uint128 liquidityBurned
        )
    {
        if (gaugeAddress != address(0)) {
            IERC20(gaugeAddress).safeTransferFrom(
                msg.sender,
                address(this),
                burnAmount
            );

            IGauge(gaugeAddress).withdraw(burnAmount);
        } else {
            IERC20(address(pool)).safeTransferFrom(
                msg.sender,
                address(this),
                burnAmount
            );
        }

        if (receiveETH) {
            (amount0, amount1, liquidityBurned) = pool.burn(
                burnAmount,
                address(this)
            );
        } else {
            (amount0, amount1, liquidityBurned) = pool.burn(
                burnAmount,
                receiver
            );
        }

        require(
            amount0 >= amount0Min && amount1 >= amount1Min,
            "received below minimum"
        );

        if (receiveETH) {
            _receiveETH(pool, amount0, amount1, receiver);
        }
    }

    // solhint-disable-next-line code-complexity
    function _receiveETH(
        IArrakisVaultV1 pool,
        uint256 amount0,
        uint256 amount1,
        address payable receiver
    ) internal {
        IERC20 token0 = pool.token0();
        IERC20 token1 = pool.token1();
        bool wethToken0 = _isToken0Weth(address(token0), address(token1));
        if (wethToken0) {
            if (amount0 > 0) {
                weth.withdraw(amount0);
                receiver.sendValue(amount0);
            }
            if (amount1 > 0) {
                token1.safeTransfer(receiver, amount1);
            }
        } else {
            if (amount1 > 0) {
                weth.withdraw(amount1);
                receiver.sendValue(amount1);
            }
            if (amount0 > 0) {
                token0.safeTransfer(receiver, amount0);
            }
        }
    }

    // solhint-disable-next-line function-max-lines
    function _swap(
        IArrakisVaultV1 _pool,
        SwapData memory _swapData,
        uint256 _amount0Max,
        uint256 _amount1Max,
        uint256 _ethValue
    ) internal returns (uint256 amount0Use, uint256 amount1Use) {
        require(
            _swapData.swapPayload.length == 1,
            "only 1 swap transaction allowed"
        );

        uint256 balance0Before = _pool.token0().balanceOf(address(this));
        uint256 balance1Before = _pool.token1().balanceOf(address(this));

        if (_ethValue > 0) {
            (bool success, bytes memory returnsData) =
                _swapData.swapRouter.call{value: _ethValue}(
                    _swapData.swapPayload[0]
                );
            if (!success) GelatoBytes.revertWithError(returnsData, "swap: ");
        } else {
            (bool success, bytes memory returnsData) =
                _swapData.swapRouter.call(_swapData.swapPayload[0]);
            if (!success) GelatoBytes.revertWithError(returnsData, "swap: ");
        }

        uint256 balance0 = _pool.token0().balanceOf(address(this));
        uint256 balance1 = _pool.token1().balanceOf(address(this));
        uint256 balanceDiff0 = balance0 - balance0Before;
        uint256 balanceDiff1 = balance1 - balance1Before;

        // are all these checks necessary?
        // if so, maybe we can merge some of them?
        if (_swapData.zeroForOne) {
            require(
                balance0Before > balance0,
                "Token0 swap failed! Incorrect balance of token0."
            );
            require(
                balance1 > balance1Before,
                "Token0 swap failed! Incorrect balance of token1."
            );
            require(
                _swapData.amountInSwap > balanceDiff0,
                "Token0 swap failed! Amount of token0 spent is more than max."
            );
            require(
                _swapData.amountOutSwap < balanceDiff1,
                "Token0 swap failed! Minimum amount of token1 not retrieved."
            );
            amount0Use = _amount0Max - balanceDiff0;
            amount1Use = _amount1Max + balanceDiff1;
            require(
                balance0 >= amount0Use,
                "do we need to validate balance here?"
            );
            require(
                balance1 >= amount1Use,
                "do we need to validate balance here?"
            );
        } else {
            require(
                balance0 > balance0Before,
                "Token1 swap failed! Incorrect balance of token0."
            );
            require(
                balance1Before > balance1,
                "Token1 swap failed! Incorrect balance of token1."
            );
            require(
                _swapData.amountInSwap > balanceDiff1,
                "Token1 swap failed! Amount of token1 spent is more than max."
            );
            require(
                _swapData.amountOutSwap < balanceDiff0,
                "Token1 swap failed! Minimum amount of token0 not retrieved."
            );
            amount0Use = _amount0Max + balanceDiff0;
            amount1Use = _amount1Max - balanceDiff1;
            require(
                balance0 >= amount0Use,
                "do we need to validate balance here?"
            );
            require(
                balance1 >= amount1Use,
                "do we need to validate balance here?"
            );
        }
    }

    function _isToken0Weth(address token0, address token1)
        internal
        view
        returns (bool wethToken0)
    {
        if (token0 == address(weth)) {
            wethToken0 = true;
        } else if (token1 == address(weth)) {
            wethToken0 = false;
        } else {
            revert("one pool token must be WETH");
        }
    }
}
