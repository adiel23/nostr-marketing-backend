export const PLATFORM_FEE_RATE = 0.02;

export function calculatePlatformFee(satsPerImpact: number): number {
  return Math.ceil(satsPerImpact * PLATFORM_FEE_RATE);
}
