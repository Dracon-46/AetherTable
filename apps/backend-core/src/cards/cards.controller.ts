import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CardsService } from './cards.service.js';
import { CardImageService } from './card-image.service.js';
import { ColecaoDto } from './cards.dto.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';

/**
 * cards.controller.ts — a Scryfall vista pelo nosso domínio.
 *
 * SEM AUTENTICAÇÃO, DE PROPÓSITO
 *
 * A rota de imagem é consumida por `<img src>` e por `new Image()` no Canvas —
 * nenhum dos dois manda cabeçalho `Authorization`. Exigir JWT aqui significaria
 * baixar cada arte por `fetch` e virar blob, jogando fora o cache do navegador,
 * que é justamente o que faz a mesa abrir rápido.
 *
 * O que protege a rota é outra coisa: o destino é montado a partir de um UUID
 * validado (nunca de uma URL do cliente), o conteúdo servido é público, e o
 * limite por IP abaixo impede que ela vire CDN alheia.
 *
 * As rotas JSON seguem o mesmo raciocínio: espelham dado público e já estão
 * atrás da fila de 100 ms do `ScryfallClient`, que é o teto real de tráfego que
 * conseguimos gerar contra a Scryfall, venha de quem vier.
 */

/** Um mês. A arte de uma impressão não muda; a chave da URL identifica ela. */
const CACHE_IMAGEM = 'public, max-age=2592000, immutable';

/**
 * O limite global (10 req/5 s) é para navegação, não para arte.
 *
 * Uma mesa de Commander com quatro campos de batalha abre facilmente 80
 * imagens no primeiro render. Sob o balde padrão, as setenta últimas voltariam
 * 429 e o jogador veria uma mesa de cartas em branco — a proteção produzindo
 * exatamente o bug que este módulo existe para corrigir.
 */
const LIMITE_IMAGEM = {
  curto: { limit: 120, ttl: 5_000 },
  longo: { limit: 900, ttl: 60_000 },
};

/** Busca é digitada por humano, com debounce de 500 ms no cliente. */
const LIMITE_BUSCA = {
  curto: { limit: 20, ttl: 5_000 },
  longo: { limit: 200, ttl: 60_000 },
};

@ApiTags('Cards')
@Controller('cards')
export class CardsController {
  constructor(
    private readonly cards: CardsService,
    private readonly imagens: CardImageService,
  ) {}

  /**
   * `GET /cards/img/:scryfallId?quality=normal&face=front`
   *
   * Espelha `cards.scryfall.io`. Devolve 404 quando a combinação não existe —
   * pedir `face=back` de uma carta comum é o caso normal disso.
   */
  @Get('img/:scryfallId')
  @Throttle(LIMITE_IMAGEM)
  @ApiOperation({ summary: 'Arte da carta, servida pelo nosso domínio' })
  async imagem(
    @Param('scryfallId') scryfallId: string,
    @Query('quality') quality: string | undefined,
    @Query('face') face: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const parametros = CardImageService.validar(scryfallId, quality, face);
    if (!parametros) {
      throw new BadRequestException('Id, qualidade ou face inválidos.');
    }

    const imagem = await this.imagens.obter(parametros.id, parametros.qualidade, parametros.face);
    if (!imagem) {
      throw new NotFoundException('Imagem não disponível para esta carta.');
    }

    // Segundo acesso na mesma aba: 304 e zero bytes no fio.
    if (req.headers['if-none-match'] === imagem.etag) {
      res.status(304).setHeader('ETag', imagem.etag);
      res.end();
      return;
    }

    res.setHeader('Content-Type', imagem.tipo);
    res.setHeader('Cache-Control', CACHE_IMAGEM);
    res.setHeader('ETag', imagem.etag);
    // O Canvas carrega a textura com `crossOrigin='anonymous'`; sem isto o
    // `getImageData` marcaria o canvas como contaminado.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(imagem.corpo);
  }

  /** `GET /cards/search?q=...` — deckbuilder, seletor de impressão e fichas. */
  @Get('search')
  @Throttle(LIMITE_BUSCA)
  @ApiOperation({ summary: 'Busca na Scryfall pela API (fila e User-Agent nossos)' })
  search(
    @Query('q') q: string,
    @Query('unique') unique?: string,
    @Query('page') page?: string,
    @Query('order') order?: string,
    @Query('dir') dir?: string,
  ) {
    const query = (q ?? '').trim();
    if (query.length < 2) {
      throw new BadRequestException('Informe pelo menos 2 caracteres na busca.');
    }
    if (query.length > 400) {
      throw new BadRequestException('Busca longa demais.');
    }

    const pagina = page ? Number(page) : undefined;
    if (pagina !== undefined && (!Number.isInteger(pagina) || pagina < 1 || pagina > 100)) {
      throw new BadRequestException('Página inválida.');
    }

    return this.cards.search(query, unique, pagina, order, dir);
  }

  /** `GET /cards/autocomplete?q=...` — até 20 nomes. */
  @Get('autocomplete')
  @Throttle(LIMITE_BUSCA)
  autocomplete(@Query('q') q: string) {
    const query = (q ?? '').trim();
    if (query.length < 2) throw new BadRequestException('Informe pelo menos 2 caracteres.');
    return this.cards.autocomplete(query.slice(0, 200));
  }

  /** `POST /cards/collection` — hidratação em lote do catálogo da mesa. */
  @Post('collection')
  @Throttle(LIMITE_BUSCA)
  @ApiOperation({ summary: 'Metadados de até 75 cartas de uma vez' })
  collection(@Body(new ZodValidationPipe(ColecaoDto)) dto: ColecaoDto) {
    return this.cards.collection(dto.identifiers);
  }

  /**
   * `GET /cards/:scryfallId` — impressão específica.
   *
   * Declarada por ÚLTIMO de propósito: o Nest casa rotas na ordem em que são
   * definidas, e um `:scryfallId` no topo engoliria `search` e `autocomplete`.
   */
  @Get(':scryfallId')
  @Throttle(LIMITE_BUSCA)
  cardById(@Param('scryfallId', ParseUUIDPipe) scryfallId: string) {
    return this.cards.cardById(scryfallId);
  }
}
