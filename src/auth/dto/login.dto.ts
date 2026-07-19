// src/companies/dto/create-company.dto.ts
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(72)
  password!: string;
}
