import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { CompaniesModule } from 'src/companies/companies.module';
import {PassportModule} from "@nestjs/passport";
import {JwtModule} from "@nestjs/jwt";
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    CompaniesModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: 'MI_CLAVE_SECRETA_SUPER_SEGURA', // Cambiar por variable de entorno
      signOptions: { expiresIn: '1h' }, // El token expira en 1 hora
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [PassportModule, JwtModule, AuthService, JwtStrategy]
})
export class AuthModule {}
