// src/auth/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { requiredEnv } from 'src/common/env.util';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      // Extrae el token del header como 'Authorization: Bearer <token>'
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false, // Rechaza el token si ya expiró
      secretOrKey: requiredEnv('JWT_SECRET'),
    });
  }

  // Este método se ejecuta automáticamente si el token es válido
  async validate(payload: any) {
    // Lo que devuelvas aquí se inyectará automáticamente en el objeto `req.user`
    return { id: payload.sub, email: payload.email };
  }
}
