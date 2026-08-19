/** Entity ID construction. */
export function entityId(chainId: number, baseId: string): string {
  return `${chainId}-${baseId}`;
}

export function stripChainPrefix(id: string): string {
  return id.replace(/^\d+-/, "");
}

export function toLowerHex(value: string): string {
  return value.toLowerCase();
}

export function positionId(tokenId: bigint): string {
  return tokenId.toString();
}

export function eventId(transactionHash: string, logIndex: number): string {
  return `${toLowerHex(transactionHash)}-${logIndex}`;
}
