/** incentiveId = keccak256(abi.encode(rewardToken, bonusRewardToken, pool, nonce)). */
import { encodeAbiParameters, keccak256 } from "viem";

const INCENTIVE_KEY = [
  { type: "address" }, // rewardToken
  { type: "address" }, // bonusRewardToken
  { type: "address" }, // pool
  { type: "uint256" }, // nonce
] as const;

export function computeIncentiveId(
  rewardToken: string,
  bonusRewardToken: string,
  pool: string,
  nonce: bigint,
): string {
  return keccak256(
    encodeAbiParameters(INCENTIVE_KEY, [
      rewardToken as `0x${string}`,
      bonusRewardToken as `0x${string}`,
      pool as `0x${string}`,
      nonce,
    ]),
  ).toLowerCase();
}
