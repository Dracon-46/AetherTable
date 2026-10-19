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
  ServiceUnavailableException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { pendingCount } from '@aethertable/scryfall-client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CardsService } from './cards.service.js';
import { CardImageService } from './card-image.service.js';
import { ColecaoDto } from './cards.dto.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CODIGOS_DE_IDIOMA } from '@aethertable/shared-types';

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

/**
 * ─── A FILA DA SCRYFALL É UMA SÓ, E ESTAS ROTAS SÃO PÚBLICAS ────────────────
 *
 * O `ScryfallClient` serializa TODA chamada do servidor com 100 ms entre
 * inícios — a hidratação do deck na entrada da mesa, o gerador, as sugestões,
 * e estas rotas. O limite por IP não protege a fila: vinte IPs dentro do
 * próprio limite empilham centenas de buscas, e a entrada na mesa de quem
 * está jogando passa a esperar atrás delas por minutos.
 *
 * Passado este tamanho (dois segundos de fila), as rotas públicas recusam na
 * hora em vez de entrar no fim dela. Quem está dentro do servidor (a mesa, o
 * deckbuilder salvando) segue pela fila normalmente.
 */
export const FILA_MAXIMA_DA_SCRYFALL = 20;

function exigirFilaLivre(): void {
  if (pendingCount() > FILA_MAXIMA_DA_SCRYFALL) {
    throw new ServiceUnavailableException('Muitas buscas agora; tente em instantes.');
  }
}

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
  async search(
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
    exigirFilaLivre();

    /**
     * ─── BUSCA SEM RESULTADO É LISTA VAZIA, NÃO 404 ─────────────────────────
     *
     * A Scryfall responde 404 a uma busca que não acha nada, e a rota repassava.
     * Para quem chama, "nenhuma carta" não é erro — a grade dos Desafios testa
     * cruzamentos que podem não ter resposta, e cada um virava uma linha
     * vermelha no console do navegador. Só a ROTA traduz: quem usa o
     * `CardsService` por dentro (gerador, sugestões, idioma) continua recebendo
     * o 404 que já trata.
     */
    try {
      return await this.cards.search(query, unique, pagina, order, dir);
    } catch (erro) {
      if (erro instanceof NotFoundException) {
        return { object: 'list', total_cards: 0, has_more: false, data: [] };
      }
      throw erro;
    }
  }

  /** `GET /cards/autocomplete?q=...` — até 20 nomes. */
  @Get('autocomplete')
  @Throttle(LIMITE_BUSCA)
  autocomplete(@Query('q') q: string) {
    const query = (q ?? '').trim();
    if (query.length < 2) throw new BadRequestException('Informe pelo menos 2 caracteres.');
    exigirFilaLivre();
    return this.cards.autocomplete(query.slice(0, 200));
  }

  /** `POST /cards/collection` — hidratação em lote do catálogo da mesa. */
  @Post('collection')
  @Throttle(LIMITE_BUSCA)
  @ApiOperation({ summary: 'Metadados de até 75 cartas de uma vez' })
  collection(@Body(new ZodValidationPipe(ColecaoDto)) dto: ColecaoDto) {
    exigirFilaLivre();
    return this.cards.collection(dto.identifiers);
  }

  /**
   * `GET /cards/printings/:scryfallId` — todas as impressões daquela carta.
   *
   * Declarada ANTES de `:scryfallId` — ver a nota na rota seguinte sobre a
   * ordem de casamento do Nest. Sob o prefixo `printings/` ela não colide,
   * mas manter a ordem evita que a próxima rota adicionada aqui esbarre nisso.
   */
  @Get('printings/:scryfallId')
  @Throttle(LIMITE_BUSCA)
  @ApiOperation({ summary: 'Todas as impressões de uma carta, por oracle_id' })
  printings(
    @Param('scryfallId', ParseUUIDPipe) scryfallId: string,
    // Mais um idioma além do inglês. Lista fechada: vira `lang:` dentro da
    // busca, e texto livre ali seria sintaxe de busca vinda do cliente.
    @Query('idioma') idioma?: string,
  ) {
    const extra = idioma && idioma !== 'en' && CODIGOS_DE_IDIOMA.includes(idioma as never);
    return this.cards.printings(scryfallId, extra ? idioma : undefined);
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
