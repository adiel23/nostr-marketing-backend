import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsInt,
  Min,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { CampaignCommentMode } from '../entities/campaign.entity';

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  productDescription!: string;

  @IsString()
  @IsNotEmpty()
  promotionalComment!: string;

  @IsEnum(CampaignCommentMode)
  commentMode: CampaignCommentMode = CampaignCommentMode.FIXED;

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  keywords!: string[];

  @IsString()
  @IsNotEmpty()
  nwcUrl!: string;

  @IsInt()
  @Min(0)
  @IsNotEmpty()
  satsPerImpact!: number;

  @IsDateString()
  @IsNotEmpty()
  endsAt!: string;
}
