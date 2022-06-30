// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.6;

import "@gnosis.pm/zodiac/contracts/core/Module.sol";

import "./MultisendEncoder.sol";
import "./IDebtPosition.sol";
import "./ILiquidityPosition.sol";

struct AssetFlow {
    address dp;
    address lp;
}

contract Siphon is Module, MultisendEncoder {
    mapping(string => AssetFlow) public flows;

    error FlowIsPlugged();

    error FlowIsUnplugged();

    error UnsuitableAdapter();

    error AssetMismatch();

    error TriggerRatioNotSet();

    error TargetRatioNotSet();

    error DebtPositionIsHealthy();

    error UnstableLiquiditySource();

    error NoLiquidityInvested();

    error NoLiquidityWithdrawn();

    error WithdrawalFailed();

    error PaymentFailed();

    /// @param _owner Address of the owner
    /// @param _avatar Address of the avatar (e.g. a Gnosis Safe)
    /// @param _target Address of the contract that will call exec function
    constructor(
        address _owner,
        address _avatar,
        address _target
    ) {
        bytes memory initParams = abi.encode(_owner, _avatar, _target);
        setUp(initParams);
    }

    function setUp(bytes memory initParams) public override initializer {
        (address _owner, address _avatar, address _target) = abi.decode(
            initParams,
            (address, address, address)
        );
        __Ownable_init();

        avatar = _avatar;
        target = _target;

        transferOwnership(_owner);
    }

    function plug(
        string memory tube,
        address dp,
        address lp
    ) public onlyOwner {
        if (isPlugged(tube)) {
            revert FlowIsPlugged();
        }

        if (dp == address(0) || lp == address(0)) {
            revert UnsuitableAdapter();
        }

        if (ILiquidityPosition(dp).asset() != IDebtPosition(lp).asset()) {
            revert AssetMismatch();
        }

        flows[tube] = AssetFlow({dp: dp, lp: lp});
    }

    function unplug(string memory tube) public onlyOwner {
        if (!isPlugged(tube)) {
            revert FlowIsUnplugged();
        }

        delete flows[tube];
    }

    function payDebt(string memory tube) public {
        if (!isPlugged(tube)) {
            revert FlowIsUnplugged();
        }

        AssetFlow storage flow = flows[tube];

        IDebtPosition dp = IDebtPosition(flow.dp);
        ILiquidityPosition lp = ILiquidityPosition(flow.lp);

        uint256 triggerRatio = dp.ratioTrigger();
        if (triggerRatio == 0) {
            revert TriggerRatioNotSet();
        }

        uint256 ratio = dp.ratio();
        if (ratio > triggerRatio) {
            revert DebtPositionIsHealthy();
        }

        uint256 targetRatio = dp.ratioTarget();
        if (targetRatio < triggerRatio) {
            revert TargetRatioNotSet();
        }

        if (lp.balance() == 0) {
            revert NoLiquidityInvested();
        }

        if (!lp.canWithdraw()) {
            revert UnstableLiquiditySource();
        }

        uint256 prevBalance = lp.assetBalance();
        uint256 requiredAmountOut = dp.delta();

        address to;
        uint256 value;
        bytes memory data;
        Enum.Operation operation;

        (to, value, data, operation) = encodeMultisend(
            lp.withdrawalInstructions(requiredAmountOut)
        );
        if (!exec(to, value, data, Enum.Operation.Call)) {
            revert WithdrawalFailed();
        }

        uint256 actualAmountOut = lp.assetBalance() - prevBalance;

        if (actualAmountOut == 0) {
            revert NoLiquidityWithdrawn();
        }

        (to, value, data, operation) = encodeMultisend(
            dp.paymentInstructions(actualAmountOut)
        );
        if (!exec(to, value, data, Enum.Operation.Call)) {
            revert PaymentFailed();
        }
    }

    function isPlugged(string memory tube) internal view returns (bool) {
        AssetFlow storage flow = flows[tube];
        return flow.dp != address(0) && flow.lp != address(0);
    }
}
