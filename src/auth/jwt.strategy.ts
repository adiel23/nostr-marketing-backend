// src/auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecret } from 'src/config/environment';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      // Extrae el token del header como 'Authorization: Bearer <token>'
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false, // Rechaza el token si ya expiró
      secretOrKey: getJwtSecret(),
    });
  }

  // Este método se ejecuta automáticamente si el token es válido
  validate(payload: { sub: string; email: string }) {
    // Lo que devuelvas aquí se inyectará automáticamente en el objeto `req.user`
    return { id: payload.sub, email: payload.email };
  }
}
