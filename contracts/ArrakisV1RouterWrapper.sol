// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;

import {
    IGauge,
    IArrakisV1RouterStaking,
    AddLiquidityData,
    SwapData,
    MintData
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
import {
    IArrakisSwappersWhitelist
} from "./interfaces/IArrakisSwappersWhitelist.sol";

contract ArrakisV1RouterWrapper is
    Initializable,
    PausableUpgradeable,
    OwnableUpgradeable
{
    using Address for address payable;
    using SafeERC20 for IERC20;

    IWETH public immutable weth;
    IArrakisSwappersWhitelist public immutable whitelist;
    IArrakisV1RouterStaking public router;

    constructor(IWETH _weth, IArrakisSwappersWhitelist _whitelist) {
        weth = _weth;
        whitelist = _whitelist;
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
    // solhint-disable-next-line code-complexity, function-max-lines
    function addLiquidity(
        IArrakisVaultV1 pool,
        AddLiquidityData memory _addData
    )
        external
        payable
        whenNotPaused
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        )
    {
        IERC20 token0 = pool.token0();
        IERC20 token1 = pool.token1();

        (uint256 amount0In, uint256 amount1In, uint256 _mintAmount) =
            pool.getMintAmounts(_addData.amount0Max, _addData.amount1Max);
        require(
            amount0In >= _addData.amount0Min &&
                amount1In >= _addData.amount1Min,
            "below min amounts"
        );
        require(_mintAmount > 0, "nothing to mint");
        if (_addData.gaugeAddress != address(0)) {
            require(
                address(pool) == IGauge(_addData.gaugeAddress).staking_token(),
                "Incorrect gauge!"
            );
        }

        bool isToken0Weth;
        if (_addData.useETH) {
            isToken0Weth = _isToken0Weth(address(token0), address(token1));
            require(
                (isToken0Weth && _addData.amount0Max == msg.value) ||
                    (!isToken0Weth && _addData.amount1Max == msg.value),
                "mismatching amount of ETH forwarded"
            );
            if (isToken0Weth && amount0In > 0) {
                weth.deposit{value: amount0In}();
                IERC20(address(weth)).safeTransfer(address(router), amount0In);
            }
            if (!isToken0Weth && amount1In > 0) {
                weth.deposit{value: amount1In}();
                IERC20(address(weth)).safeTransfer(address(router), amount1In);
            }
        }

        if (
            amount0In > 0 &&
            (!_addData.useETH || (_addData.useETH && !isToken0Weth))
        ) {
            token0.safeTransferFrom(msg.sender, address(router), amount0In);
        }
        if (
            amount1In > 0 &&
            (!_addData.useETH || (_addData.useETH && isToken0Weth))
        ) {
            token1.safeTransferFrom(msg.sender, address(router), amount1In);
        }

        MintData memory _mintData = MintData(amount0In, amount1In, _mintAmount);
        (amount0, amount1, mintAmount) = router.addLiquidity(
            pool,
            _addData,
            _mintData
        );

        if (_addData.useETH) {
            if (isToken0Weth && _addData.amount0Max > amount0) {
                payable(msg.sender).sendValue(_addData.amount0Max - amount0);
            } else if (!isToken0Weth && _addData.amount1Max > amount1) {
                payable(msg.sender).sendValue(_addData.amount1Max - amount1);
            }
        }
    }

    /// @notice swapAndAddLiquidity transfer tokens to and calls ArrakisV1Router
    /// @param pool The ArrakisVaultV1 pool
    /// @param _addData AddLiquidityData struct containing data for adding liquidity
    /// @param _swapData SwapData struct containing data for swap
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
        whenNotPaused
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        )
    {
        require(
            _swapData.swapPayload.length == 1,
            "Only 1 swap transaction allowed!"
        );
        require(
            whitelist.verify(_swapData.swapRouter),
            "Swap router address not whitelisted!"
        );
        IERC20 token0 = pool.token0();
        IERC20 token1 = pool.token1();
        bool isToken0Weth;
        if (_addData.useETH) {
            isToken0Weth = _isToken0Weth(address(token0), address(token1));
            if (_swapData.zeroForOne && isToken0Weth) {
                require(
                    _addData.amount0Max == msg.value,
                    "mismatching amount of ETH forwarded for token0"
                );
            } else if (!_swapData.zeroForOne && !isToken0Weth) {
                require(
                    _addData.amount1Max == msg.value,
                    "mismatching amount of ETH forwarded for token1"
                );
            }
        }
        if (
            _addData.amount0Max > 0 &&
            (!_addData.useETH ||
                (_addData.useETH && _swapData.zeroForOne && !isToken0Weth))
        ) {
            token0.safeTransferFrom(
                msg.sender,
                address(router),
                _addData.amount0Max
            );
        }
        if (
            _addData.amount1Max > 0 &&
            (!_addData.useETH ||
                (_addData.useETH && !_swapData.zeroForOne && isToken0Weth))
        ) {
            token1.safeTransferFrom(
                msg.sender,
                address(router),
                _addData.amount1Max
            );
        }

        (amount0, amount1, mintAmount) = router.swapAndAddLiquidity(
            pool,
            _addData,
            _swapData
        );
    }

    function updateRouter(IArrakisV1RouterStaking _router) external onlyOwner {
        router = _router;
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
