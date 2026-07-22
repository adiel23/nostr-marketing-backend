import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { CompaniesModule } from 'src/companies/companies.module';
import {PassportModule} from "@nestjs/passport";
import {JwtModule} from "@nestjs/jwt";
import { JwtStrategy } from './jwt.strategy';
import { requiredEnv } from 'src/common/env.util';

@Module({
  imports: [
    CompaniesModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: requiredEnv('JWT_SECRET'),
      signOptions: { expiresIn: '1h' }, // El token expira en 1 hora
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [PassportModule, JwtModule, AuthService, JwtStrategy]
})
export class AuthModule {}
