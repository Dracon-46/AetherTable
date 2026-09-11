import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CatalogoDeCosmeticosService } from './catalogo.service.js';

/**
 * catalogo.controller.ts — o catálogo autoral, de graça e sem login.
 *
 * ─── POR QUE É PÚBLICO ─────────────────────────────────────────────────────
 *
 * O `game-server` é quem mais precisa desta rota, e ele não tem token de
 * usuário — ele é um serviço. Exigir autenticação aqui significaria inventar
 * uma credencial de serviço para proteger uma lista de nomes de cores, que é
 * exatamente o que qualquer jogador vê ao abrir o seletor de cosméticos. Não há
 * nada aqui que já não esteja no bundle do cliente.
 *
 * O limite é folgado pelo mesmo motivo de `GET /flags`: é uma leitura de
 * configuração que todo cliente faz ao abrir o produto.
 */
@ApiTags('Cosméticos')
@Controller('cosmeticos')
export class CatalogoDeCosmeticosController {
  constructor(private readonly catalogo: CatalogoDeCosmeticosService) {}

  @Get('catalogo')
  @Throttle({ curto: { limit: 20, ttl: 5_000 }, longo: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Cosméticos criados no backoffice (leitura pública)' })
  catalogoAutoral() {
    return this.catalogo.atual();
  }
}
