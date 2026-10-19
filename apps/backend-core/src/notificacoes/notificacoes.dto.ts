import { z } from 'zod';
import { MAX_VERSAO_DE_NOVIDADE } from '@aethertable/shared-types';

/**
 * `PUT /notificacoes/leitura` — o "já vi" do sino.
 *
 * `vistoEm` é ISO 8601 com fuso (o `toISOString()` do navegador manda `Z`).
 * A trava de "não muito no futuro" não cabe aqui: depende do relógio do
 * servidor no instante da requisição, e o DTO valida o corpo isolado. Ela
 * mora em `NotificacoesService.marcarLeitura`.
 */
export const MarcarLeituraDto = z.object({
  vistoEm: z.string().datetime({ offset: true }),
  novidadeVista: z.string().trim().min(1).max(MAX_VERSAO_DE_NOVIDADE),
});
export type MarcarLeituraDto = z.infer<typeof MarcarLeituraDto>;
