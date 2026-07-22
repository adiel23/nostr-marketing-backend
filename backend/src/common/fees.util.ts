import { CampaignCommentMode } from 'src/campaigns/entities/campaign.entity';

export const FIXED_COMMENT_PLATFORM_FEE_RATE = 0.02;
export const AI_COMMENT_PLATFORM_FEE_RATE = 0.05;
export const MSATS_PER_SAT = 1000n;
export const ROUTING_FEE_RESERVE_RATE = 0.003;
export const MIN_ROUTING_FEE_RESERVE_MSATS = 1000n;

export function calculatePlatformFee(
  satsPerImpact: number,
  commentModeUsed: CampaignCommentMode = CampaignCommentMode.FIXED,
): number {
  const rate =
    commentModeUsed === CampaignCommentMode.AI
      ? AI_COMMENT_PLATFORM_FEE_RATE
      : FIXED_COMMENT_PLATFORM_FEE_RATE;

  return Math.ceil(satsPerImpact * rate);
}

export function satsToMsats(sats: number): bigint {
  if (!Number.isSafeInteger(sats) || sats < 0) {
    throw new Error('El monto en sats debe ser un entero seguro no negativo.');
  }
  return BigInt(sats) * MSATS_PER_SAT;
}

export function calculatePlatformFeeMsats(
  satsPerImpact: number,
  commentModeUsed: CampaignCommentMode = CampaignCommentMode.FIXED,
): bigint {
  return satsToMsats(calculatePlatformFee(satsPerImpact, commentModeUsed));
}

export function calculateRoutingReserveMsats(amountMsats: bigint): bigint {
  const percentageReserve = (amountMsats * 3n + 999n) / 1000n;
  return percentageReserve > MIN_ROUTING_FEE_RESERVE_MSATS
    ? percentageReserve
    : MIN_ROUTING_FEE_RESERVE_MSATS;
}

export function calculateRequiredImpactBalanceMsats(
  zapAmountMsats: bigint,
  platformFeeMsats: bigint,
): bigint {
  return (
    zapAmountMsats +
    platformFeeMsats +
    calculateRoutingReserveMsats(zapAmountMsats) +
    calculateRoutingReserveMsats(platformFeeMsats)
  );
}

export function msatsToSafeNumber(msats: bigint | string): number {
  const value = typeof msats === 'string' ? BigInt(msats) : msats;
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue)) {
    throw new Error('El monto en msats excede el rango seguro de NIP-47.');
  }
  return numberValue;
}
