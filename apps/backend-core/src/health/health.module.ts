import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';

/**
 * Módulo de observabilidade, responsável por prover a rota /health
 */
@Module({
  imports: [TerminusModule], // Módulo base de health checks do NestJS
  controllers: [HealthController],
})
export class HealthModule {}
