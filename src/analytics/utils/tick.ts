/** Analytics tick construction. */
import type { Analytics_Tick as Tick } from "envio";
import {
  ONE_BD,
  ZERO_BD,
  bd,
  fastExponentiation,
  safeDiv,
} from "./bigdecimal.js";
import { ZERO_BI } from "./constants.js";

export function createTick(
  tickId: string,
  tickIdx: number,
  poolId: string,
  poolAddress: string,
  timestamp: bigint,
  blockNumber: bigint,
): Tick {
  const price0 = fastExponentiation(bd("1.0001"), tickIdx);
  return {
    id: tickId,
    tickIdx: BigInt(tickIdx),
    pool_id: poolId,
    poolAddress,
    createdAtTimestamp: timestamp,
    createdAtBlockNumber: blockNumber,
    liquidityGross: ZERO_BI,
    liquidityNet: ZERO_BI,
    liquidityProviderCount: ZERO_BI,
    price0,
    price1: safeDiv(ONE_BD, price0),
    volumeToken0: ZERO_BD,
    volumeToken1: ZERO_BD,
    volumeUSD: ZERO_BD,
    feesUSD: ZERO_BD,
    untrackedVolumeUSD: ZERO_BD,
    collectedFeesToken0: ZERO_BD,
    collectedFeesToken1: ZERO_BD,
    collectedFeesUSD: ZERO_BD,
  };
}
