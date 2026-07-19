import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayNotEmpty,
  Matches,
  IsInt,
  Min,
  IsDateString,
} from 'class-validator';

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  productDescription!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @Matches(/\S/, { each: true })
  keywords!: string[];

  @IsString()
  @IsNotEmpty()
  nwcUrl!: string;

  @IsInt()
  @Min(1)
  @IsNotEmpty()
  satsPerImpact!: number;

  @IsDateString()
  @IsNotEmpty()
  endsAt!: string;
}
