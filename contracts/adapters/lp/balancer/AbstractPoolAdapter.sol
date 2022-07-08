// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@gnosis.pm/zodiac/contracts/factory/FactoryFriendly.sol";

import "../../../ILiquidityPosition.sol";
import "../../../helpers/balancer/Interop.sol";

abstract contract AbstractPoolAdapter is ILiquidityPosition, FactoryFriendly {
    uint256 private constant DEFAULT_PARITY_TOLERANCE = 20;
    uint256 private constant DEFAULT_SLIPPAGE = 50;
    uint256 private constant DEFAULT_BLOCK_AGE = 5;

    address public investor;
    address public vault;
    address public pool;
    address public gauge;
    address public tokenOut;

    uint256 public parityTolerance;
    uint256 public minBlockAge;
    uint256 public slippage;

    function setUp(bytes memory initParams) public override initializer {
        (
            address _owner,
            address _investor,
            address _pool,
            address _gauge,
            address _tokenOut
        ) = abi.decode(
                initParams,
                (address, address, address, address, address)
            );
        __Ownable_init();

        investor = _investor;
        vault = IPool(_pool).getVault();
        pool = _pool;
        gauge = _gauge;

        tokenOut = _tokenOut;

        parityTolerance = basisPoints(DEFAULT_PARITY_TOLERANCE);
        slippage = basisPoints(DEFAULT_SLIPPAGE);
        minBlockAge = DEFAULT_BLOCK_AGE;
        _transferOwnership(_owner);
    }

    function asset() external view override returns (address) {
        return tokenOut;
    }

    function balance() public view virtual override returns (uint256);

    function canWithdraw() external view override returns (bool) {
        // we should make sure the pool has at least 1M nomimal value?
        return isOldEnough() && isInParity();
    }

    function withdrawalInstructions(uint256 requestedAmountOut)
        external
        view
        override
        returns (Transaction[] memory)
    {
        (uint256 unstakedBalance, ) = bptBalances();

        (uint8 kind, uint256 amountIn, uint256 amountOut) = calculateExit(
            requestedAmountOut
        );

        uint256 amountToUnstake = amountIn > unstakedBalance
            ? amountIn - unstakedBalance
            : 0;

        Transaction[] memory result;
        if (amountToUnstake > 0) {
            result = new Transaction[](2);
            result[0] = encodeUnstake(amountToUnstake);
            result[1] = encodeExit(kind, amountIn, amountOut);
        } else {
            result = new Transaction[](1);
            result[0] = encodeExit(kind, amountIn, amountOut);
        }
        return result;
    }

    function isInParity() public view virtual returns (bool);

    function isOldEnough() public view returns (bool) {
        (, , uint256 lastModifiedBlock) = IVault(vault).getPoolTokens(
            IPool(pool).getPoolId()
        );

        uint256 age = block.number - lastModifiedBlock;

        return age >= minBlockAge;
    }

    function encodeUnstake(uint256 amount)
        internal
        view
        returns (Transaction memory)
    {
        //0x2e1a7d4d -> "withdraw(uint256)"
        return
            Transaction({
                to: gauge,
                value: 0,
                data: abi.encodeWithSelector(0x2e1a7d4d, amount),
                operation: Enum.Operation.Call
            });
    }

    function encodeExit(
        uint8 kind,
        uint256 amountIn,
        uint256 amountOut
    ) internal view virtual returns (Transaction memory);

    function calculateExit(uint256 requestedAmountOut)
        internal
        view
        virtual
        returns (
            uint8 kind,
            uint256 amountIn,
            uint256 amountOut
        );

    function bptBalances()
        public
        view
        returns (uint256 unstakedBalance, uint256 stakedBalance)
    {
        unstakedBalance = IERC20(pool).balanceOf(investor);
        stakedBalance = IERC20(gauge).balanceOf(investor);
    }

    function setParityTolerance(uint256 bips) external onlyOwner {
        parityTolerance = basisPoints(bips);
    }

    function setMinBlockAge(uint256 _minBlockAge) external onlyOwner {
        minBlockAge = _minBlockAge;
    }

    function setSlippage(uint256 bips) external onlyOwner {
        slippage = basisPoints(bips);
    }

    function basisPoints(uint256 bips) public pure returns (uint256) {
        require(bips <= 10000, "Invalid BIPS value");
        return bips * 1e14;
    }
}
