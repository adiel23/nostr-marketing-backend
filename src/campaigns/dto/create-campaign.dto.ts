import { 
  IsString, 
  IsNotEmpty, 
  IsArray, 
  IsInt, 
  Min, 
  IsDateString 
} from 'class-validator';

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsNotEmpty()
  productDescription!: string;

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