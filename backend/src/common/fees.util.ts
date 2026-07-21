import { CampaignCommentMode } from 'src/campaigns/entities/campaign.entity';

export const FIXED_COMMENT_PLATFORM_FEE_RATE = 0.02;
export const AI_COMMENT_PLATFORM_FEE_RATE = 0.05;

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
