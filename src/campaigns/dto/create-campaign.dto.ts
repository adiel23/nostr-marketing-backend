import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  Matches,
  IsInt,
  Min,
  IsDateString,
  MaxLength,
} from 'class-validator';

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  productDescription!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(100, { each: true })
  @Matches(/\S/, { each: true })
  keywords!: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  nwcUrl!: string;

  @IsInt()
  @Min(1)
  @IsNotEmpty()
  satsPerImpact!: number;

  @IsInt()
  @Min(1)
  @IsNotEmpty()
  budgetSats!: number;

  @IsDateString()
  @IsNotEmpty()
  endsAt!: string;
}
