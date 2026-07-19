import { CampaignStatus } from '../entities/campaign.entity';

export class CampaignResponseDto {
  id!: string;
  companyId!: string;
  name!: string;
  productDescription!: string;
  keywords!: string[];
  satsPerImpact!: number;
  budgetSats!: number;
  reservedSats!: number;
  spentSats!: number;
  status!: CampaignStatus;
  createdAt!: Date;
  endsAt!: Date;
}
