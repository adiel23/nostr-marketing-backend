export const PLATFORM_FEE_RATE = 0.02;
export const ROUTING_FEE_MARGIN = 0.003;
export const WALLET_RESERVE_MULTIPLIER =
  1 + PLATFORM_FEE_RATE + ROUTING_FEE_MARGIN;
export const MSATS_PER_SAT = 1_000;

export function calculatePlatformFee(satsPerImpact: number): number {
  return Math.ceil(satsPerImpact * PLATFORM_FEE_RATE);
}

export function estimateImpactCostSats(satsPerImpact: number): number {
  return Math.ceil(satsPerImpact * WALLET_RESERVE_MULTIPLIER);
}
