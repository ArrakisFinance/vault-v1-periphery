// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;

import {
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
import {
    IArrakisSwappersWhitelist
} from "./interfaces/IArrakisSwappersWhitelist.sol";

contract ArrakisV1SwapProxy is
    Initializable,
    PausableUpgradeable,
    OwnableUpgradeable
{
    using Address for address payable;
    using SafeERC20 for IERC20;

    IWETH public immutable weth;
    IArrakisV1RouterStaking public immutable router;
    IArrakisSwappersWhitelist public immutable whitelist;

    constructor(
        IWETH _weth,
        IArrakisV1RouterStaking _router,
        IArrakisSwappersWhitelist _whitelist
    ) {
        weth = _weth;
        router = _router;
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

    // solhint-disable-next-line max-line-length
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
