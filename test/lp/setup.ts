import dotenv from "dotenv";
import { Contract } from "ethers";
import hre, { ethers, getNamedAccounts } from "hardhat";

import {
  DAI_ADDRESS,
  DAI_WHALE,
  MAX_UINT256,
  TETHER_ADDRESS,
  TETHER_WHALE,
  USDC_ADDRESS,
  USDC_WHALE,
  VAULT_ADDRESS,
} from "./constants";

export async function fork(blockNumber: number): Promise<void> {
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
          blockNumber,
        },
      },
    ],
  });
}

export async function forkReset(): Promise<void> {
  await hre.network.provider.request({
    method: "hardhat_reset",
    params: [],
  });
}

export async function fundWhaleWithStables(): Promise<void> {
  const { BigWhale } = await getNamedAccounts();
  const signer = hre.ethers.provider.getSigner(BigWhale);

  const dai = await fundWhale(DAI_ADDRESS, DAI_WHALE);
  const tether = await fundWhale(TETHER_ADDRESS, TETHER_WHALE);
  const usdc = await fundWhale(USDC_ADDRESS, USDC_WHALE);

  await dai.connect(signer).approve(VAULT_ADDRESS, MAX_UINT256);
  await tether.connect(signer).approve(VAULT_ADDRESS, MAX_UINT256);
  await usdc.connect(signer).approve(VAULT_ADDRESS, MAX_UINT256);
}

async function fundWhale(
  tokenAddress: string,
  fromAddress: string
): Promise<Contract> {
  const { BigWhale } = await getNamedAccounts();

  const token = await hre.ethers.getContractAt("ERC20", tokenAddress);

  await fundWithEth(fromAddress);

  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [fromAddress],
  });
  const signer = await hre.ethers.provider.getSigner(fromAddress);
  const balance = await token.balanceOf(fromAddress);
  await token.connect(signer).transfer(BigWhale, balance);
  return token;
}

async function fundWithEth(account: string) {
  const { BigWhale } = await getNamedAccounts();
  const signer = hre.ethers.provider.getSigner(BigWhale);

  const tx = {
    from: BigWhale,
    to: account,
    value: ethers.utils.parseEther("1"),
  };

  await signer.sendTransaction(tx);
}