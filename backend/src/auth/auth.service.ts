// src/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CompaniesService } from 'src/companies/companies.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly companiesService: CompaniesService
  ) {}

  // 1. Validar al usuario
  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const company = await this.companiesService.validateCompany(email, password);

    if (company) {
      const payload = { email: company.email, sub: company.id };
      return {
        access_token: this.jwtService.sign(payload),
        company: this.companiesService.toPublicCompany(company),
      };
    }

    throw new UnauthorizedException('Credenciales incorrectas');
  }
}
