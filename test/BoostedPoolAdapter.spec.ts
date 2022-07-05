import { expect } from "chai";
import dotenv from "dotenv";
import { BigNumber } from "ethers";
import hre, { deployments } from "hardhat";

import { setup, setupConsolidateBPT, setupFundAvatar } from "./setup";

describe.only("LP: BoostedPoolAdapter", async () => {
  let baseSetup: any;

  before(async () => {
    // Load environment variables.
    dotenv.config();
    const { ALCHEMY_KEY } = process.env;
    // fork mainnet
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_KEY}`,
            blockNumber: 15012865,
          },
        },
      ],
    });

    baseSetup = deployments.createFixture(async ({ deployments }) => {
      await deployments.fixture();

      const { avatar, adapter, pool, gauge, dai } = await setup();

      await setupConsolidateBPT();

      await setupFundAvatar(
        avatar,
        BigNumber.from("1000000000000000000000000"),
        BigNumber.from("1000000000000000000000000")
      );

      return { avatar, adapter, pool, gauge, dai };
    });
  });

  after(async () => {
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
  });

  it("Withdrawing more than available balance yields full exit - outGivenIn", async () => {
    const { avatar, adapter, pool, gauge, dai } = await baseSetup();

    const avatarBptBalance = BigNumber.from("1000000000000000000000000");
    const avatarGaugeBalance = BigNumber.from("1000000000000000000000000");
    const adapterLiquidity = BigNumber.from("2023750178672937110658205");

    // Avatar has zero DAI
    expect(await dai.balanceOf(avatar.address)).to.equal(0);

    expect(await pool.balanceOf(avatar.address)).to.equal(avatarBptBalance);

    expect(await gauge.balanceOf(avatar.address)).to.equal(avatarGaugeBalance);

    expect(await adapter.balance()).to.equal(adapterLiquidity);

    // requesting 10x more than available
    const requestedAmountOut = adapterLiquidity.mul(10);

    const instructions = await adapter.withdrawalInstructions(
      requestedAmountOut
    );

    expect(instructions).to.have.length(2);

    await avatar.exec(
      instructions[0].to,
      instructions[0].value.toString(),
      instructions[0].data
    );

    await avatar.exec(
      instructions[1].to,
      instructions[1].value.toString(),
      instructions[1].data
    );

    // Expect BPT and StakedBPT to be drained
    await expect(await pool.balanceOf(avatar.address)).to.equal(
      BigNumber.from("0")
    );

    await expect(await gauge.balanceOf(avatar.address)).to.equal(
      BigNumber.from("0")
    );

    const slippage = await adapter.slippage();
    const outLiquidityUpper = adapterLiquidity.add(
      getSlippageSlice(adapterLiquidity, slippage)
    );
    const outLiquidityLower = adapterLiquidity.sub(
      getSlippageSlice(adapterLiquidity, slippage)
    );

    const actualAmountOut = await dai.balanceOf(avatar.address);

    // expect the amountOut to be around what was forecasted
    expect(
      actualAmountOut.gt(outLiquidityLower) &&
        actualAmountOut.lt(outLiquidityUpper)
    ).to.be.true;
  });

  it("Withdrawing close to available balances yields full exit - outGivenIn", async () => {
    const { avatar, adapter, pool, gauge, dai } = await baseSetup();

    const avatarBptBalance = BigNumber.from("1000000000000000000000000");
    const avatarGaugeBalance = BigNumber.from("1000000000000000000000000");
    const adapterLiquidity = BigNumber.from("2023750178672937110658205");

    // Avatar has zero DAI
    await expect(await dai.balanceOf(avatar.address)).to.equal(0);

    await expect(await pool.balanceOf(avatar.address)).to.equal(
      avatarBptBalance
    );
    await expect(await gauge.balanceOf(avatar.address)).to.equal(
      avatarGaugeBalance
    );
    await expect(await adapter.balance()).to.equal(adapterLiquidity);

    const slippage = await adapter.slippage();

    // withdrawing slightly less than available, should yield full exit
    const requestedAmountOut = adapterLiquidity.sub(
      getSlippageSlice(adapterLiquidity, slippage)
    );

    const instructions = await adapter.withdrawalInstructions(
      requestedAmountOut
    );

    expect(instructions).to.have.length(2);

    await avatar.exec(
      instructions[0].to,
      instructions[0].value.toString(),
      instructions[0].data
    );

    await avatar.exec(
      instructions[1].to,
      instructions[1].value.toString(),
      instructions[1].data
    );

    // Expect BPT and StakedBPT to be drained
    await expect(await pool.balanceOf(avatar.address)).to.equal(0);

    await expect(await gauge.balanceOf(avatar.address)).to.equal(0);

    // expect the amountOut to be around what was forecasted
    const outLiquidityUpper = adapterLiquidity.add(
      getSlippageSlice(adapterLiquidity, slippage)
    );
    const outLiquidityLower = adapterLiquidity.sub(
      getSlippageSlice(adapterLiquidity, slippage)
    );

    const actualAmountOut = await dai.balanceOf(avatar.address);
    expect(
      actualAmountOut.gt(outLiquidityLower) &&
        actualAmountOut.lt(outLiquidityUpper)
    ).to.be.true;
  });

  it("Withdrawing with partial unstake and exit - inGivenOut", async () => {
    // getting ~75% of liquidity should yield a partial withdrawal,
    // since we start with 50/50 stake and unstaked bpt
    const { avatar, adapter, pool, gauge, dai } = await baseSetup();

    const avatarBptBalance = BigNumber.from("1000000000000000000000000");
    const avatarGaugeBalance = BigNumber.from("1000000000000000000000000");
    const adapterLiquidity = BigNumber.from("2023750178672937110658205");

    // Avatar has zero DAI
    expect(await dai.balanceOf(avatar.address)).to.equal(0);

    expect(await pool.balanceOf(avatar.address)).to.equal(avatarBptBalance);

    expect(await gauge.balanceOf(avatar.address)).to.equal(avatarGaugeBalance);

    expect(await adapter.balance()).to.equal(adapterLiquidity);

    // roughly 75% of what's available in the liquidity position
    const requestedAmountOut = adapterLiquidity.div(100).mul(75);

    const instructions = await adapter.withdrawalInstructions(
      requestedAmountOut
    );

    expect(instructions).to.have.length(2);

    await avatar.exec(
      instructions[0].to,
      instructions[0].value.toString(),
      instructions[0].data
    );

    await avatar.exec(
      instructions[1].to,
      instructions[1].value.toString(),
      instructions[1].data
    );

    // We expect the avatar to have exactly the required DAI
    await expect(await dai.balanceOf(avatar.address)).to.equal(
      requestedAmountOut
    );

    // we expect round about half of the STAKED BPT to remain staked
    expect(
      (await gauge.balanceOf(avatar.address)).gt(
        avatarGaugeBalance.div(100).mul(49)
      ) &&
        (await gauge.balanceOf(avatar.address)).lt(
          avatarGaugeBalance.div(100).mul(51)
        )
    ).to.be.true;

    // we expect at some slippage crumbles of BPT to remain
    const slippage = await adapter.slippage();
    const bptAmountSwapped = BigNumber.from("1500000000000000000000000");
    const maxBptLeftovers = getSlippageSlice(bptAmountSwapped, slippage);

    await expect((await pool.balanceOf(avatar.address)).lt(maxBptLeftovers)).to
      .be.true;
  });

  it("Withdrawing without need to unstake, exit only - inGivenOut", async () => {
    const { avatar, adapter, dai, pool, gauge } = await baseSetup();

    const avatarBptBalance = BigNumber.from("1000000000000000000000000");
    const avatarGaugeBalance = BigNumber.from("1000000000000000000000000");
    const adapterLiquidity = BigNumber.from("2023750178672937110658205");

    // Avatar has zero DAI
    await expect(await dai.balanceOf(avatar.address)).to.equal(0);

    await expect(await pool.balanceOf(avatar.address)).to.equal(
      avatarBptBalance
    );

    await expect(await gauge.balanceOf(avatar.address)).to.equal(
      avatarGaugeBalance
    );

    await expect(await adapter.balance()).to.equal(adapterLiquidity);

    // 10% of what's available
    const requestedAmountOut = adapterLiquidity.div(100).mul(10);

    const instructions = await adapter.withdrawalInstructions(
      requestedAmountOut
    );

    // No unstaking needed
    expect(instructions).to.have.length(1);

    await avatar.exec(
      instructions[0].to,
      instructions[0].value.toString(),
      instructions[0].data
    );

    // We expect the avatar to have exactly the DAI required
    await expect(await dai.balanceOf(avatar.address)).to.equal(
      requestedAmountOut
    );

    // we expected staked BPT to remain unchanged
    await expect(await gauge.balanceOf(avatar.address)).to.equal(
      avatarGaugeBalance
    );

    const slippage = await adapter.slippage();
    // approximation: 10% of balance requested, that's 20% of unstaked used
    const bptUsed = avatarGaugeBalance.div(100).mul(20);
    // approximation plus slippage
    const bptUsedMore = bptUsed.add(getSlippageSlice(bptUsed, slippage));
    // approximation less slippage
    const bptUsedLess = bptUsed.sub(getSlippageSlice(bptUsed, slippage));

    const bptUnusedUpper = avatarBptBalance.sub(bptUsedLess);
    const bptUnusedLower = avatarBptBalance.sub(bptUsedMore);

    await expect(
      (await pool.balanceOf(avatar.address)).gt(bptUnusedLower) &&
        (await pool.balanceOf(avatar.address)).lt(bptUnusedUpper)
    ).to.be.true;
  });

  it("Withdrawing with limited DAI liquidity in LinearPool");
});

function countBasisPoints(bn: BigNumber): BigNumber {
  return bn.div(BigNumber.from("100000000000000"));
}

function getSlippageSlice(amount: BigNumber, slippage: BigNumber) {
  const bips = countBasisPoints(slippage);
  return amount.div(10000).mul(bips);
}
