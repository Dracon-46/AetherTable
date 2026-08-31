import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guardião que protege as rotas. Ele invoca a JwtStrategy por debaixo dos panos.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
