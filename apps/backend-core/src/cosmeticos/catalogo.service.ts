import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { CosmeticType, Prisma } from '@prisma/client';
import {
  normalizarCosmeticoAutoral,
  registrarCosmeticosAutorais,
  type CosmeticoAutoral,
  type FamiliaDeCosmetico,
} from '@aethertable/shared-types';
import { PrismaService } from '../common/prisma/prisma.service.js';

/**
 * catalogo.service.ts — o catálogo autoral, e como ele chega aos três processos.
 *
 * ─── O PROBLEMA QUE ESTE SERVIÇO RESOLVE ───────────────────────────────────
 *
 * Um cosmético criado no backoffice precisa ser conhecido por três processos
 * que não compartilham memória: `backend-core` valida o que entra em
 * `PATCH /users/me`, `game-server` valida a intenção de equipar na mesa, e o
 * navegador desenha. Enquanto o catálogo era só código, os três o tinham no
 * bundle e a pergunta não existia.
 *
 * A resposta aqui é deliberadamente a mais boba que funciona: este serviço é o
 * DONO do catálogo, mantém uma cópia em memória, e os outros dois a buscam por
 * HTTP de tempos em tempos. Sem fila, sem pub/sub, sem invalidação distribuída.
 *
 * ─── POR QUE NÃO ALGO MAIS ESPERTO ─────────────────────────────────────────
 *
 * O custo de estar desatualizado aqui é: durante alguns segundos, um cosmético
 * recém-criado é recusado com "fora do catálogo" pelo servidor de jogo. Nada
 * corrompe, nada fica inconsistente, ninguém perde item — o pior caso é o
 * administrador criar um mascote e precisar esperar o próximo ciclo para
 * equipá-lo. Uma infraestrutura de invalidação para comprar esses segundos
 * custaria mais para operar do que o problema que resolve.
 *
 * O que NÃO é aceitável é falhar ABERTO. Um processo que não consegue
 * sincronizar fica com o catálogo do bundle e recusa o que não conhece; ele
 * nunca passa a aceitar qualquer id porque a lista está velha.
 *
 * ─── `versao` EXISTE PARA O CLIENTE NÃO REDESENHAR À TOA ───────────────────
 *
 * Trocar o catálogo no navegador significa reavaliar sleeve e playmat de toda
 * carta na mesa. Com a versão, o cliente compara um número antes de mexer em
 * qualquer coisa — e no caso comum (nada mudou) o trabalho é zero.
 */

/** `CosmeticType` do banco → família do contrato. */
export const FAMILIA_POR_TIPO: Record<CosmeticType, FamiliaDeCosmetico> = {
  [CosmeticType.SLEEVE]: 'sleeveId',
  [CosmeticType.PLAYMAT]: 'playmatId',
  [CosmeticType.BORDER]: 'borderId',
  [CosmeticType.TITLE]: 'titleId',
  [CosmeticType.PET]: 'petId',
};

/** O que sai na rota pública. */
export interface CatalogoAutoralPublicado {
  /** Muda a cada recarga que resultou em conteúdo diferente. */
  versao: number;
  itens: CosmeticoAutoral[];
}

@Injectable()
export class CatalogoDeCosmeticosService implements OnModuleInit {
  private readonly logger = new Logger(CatalogoDeCosmeticosService.name);

  private publicado: CatalogoAutoralPublicado = { versao: 0, itens: [] };
  /** Assinatura do conteúdo atual, para não incrementar a versão à toa. */
  private assinatura = '';
  private carregando: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    /**
     * Uma falha aqui NÃO pode impedir o boot. Sem o catálogo autoral o produto
     * funciona exatamente como antes desta mudança; sem subir, não funciona
     * nada. O `recarregar` já trata e registra o erro.
     */
    await this.recarregar();
  }

  atual(): CatalogoAutoralPublicado {
    return this.publicado;
  }

  /** Chamado após toda escrita no backoffice. Não espera: a rota já respondeu. */
  invalidar(): void {
    void this.recarregar();
  }

  async recarregar(): Promise<void> {
    // Duas escritas seguidas disparam duas recargas; a segunda espera a
    // primeira em vez de correr com ela e gravar um resultado mais velho.
    if (this.carregando) return this.carregando;
    this.carregando = this.executarRecarga().finally(() => {
      this.carregando = null;
    });
    return this.carregando;
  }

  private async executarRecarga(): Promise<void> {
    try {
      const linhas = await this.prisma.cosmeticItem.findMany({
        // `Prisma.DbNull` e nao `null`: para uma coluna JSON, `null` em TypeScript
        // é ambíguo entre "a coluna é NULL" e "a coluna guarda o JSON `null`".
        where: { isActive: true, parametros: { not: Prisma.DbNull } },
        select: { type: true, parametros: true },
        orderBy: { name: 'asc' },
      });

      const itens: CosmeticoAutoral[] = [];
      let descartados = 0;
      for (const linha of linhas) {
        const p: unknown = linha.parametros;
        if (!p || typeof p !== 'object' || Array.isArray(p)) {
          descartados += 1;
          continue;
        }
        /**
         * Normaliza de novo na LEITURA, e não só na escrita.
         *
         * A linha foi validada quando entrou — mas o vocabulário pode encolher
         * numa versão futura do cliente, e um item gravado com um padrão que
         * deixou de existir desenharia errado em vez de simplesmente sumir.
         * Validar aqui faz o item cair fora sozinho no dia em que a primitiva
         * dele for removida.
         */
        const item = normalizarCosmeticoAutoral({
          ...(p as Record<string, unknown>),
          familia: FAMILIA_POR_TIPO[linha.type],
        });
        if (item) itens.push(item);
        else descartados += 1;
      }

      const assinatura = JSON.stringify(itens);
      if (assinatura !== this.assinatura) {
        this.assinatura = assinatura;
        this.publicado = { versao: this.publicado.versao + 1, itens };
      }

      // O próprio backend-core valida ids em `users.dto.ts`: ele precisa do
      // registro tanto quanto os outros dois processos.
      registrarCosmeticosAutorais(itens);

      if (descartados > 0) {
        this.logger.warn(
          `${descartados} cosmético(s) autoral(is) descartado(s) por parâmetros inválidos. ` +
            'Eles não aparecem para os jogadores — verifique a coluna `parametros`.',
        );
      }
    } catch (erro) {
      /**
       * Mantém o catálogo anterior. Trocar por uma lista vazia por causa de
       * uma queda de banco de segundos faria todo jogador com cosmético
       * autoral equipado voltar ao visual padrão — e "meus cosméticos
       * sumiram" é muito pior do que "o item novo demorou a aparecer".
       */
      this.logger.error(
        `Falha ao recarregar o catálogo autoral: ${erro instanceof Error ? erro.message : String(erro)}. ` +
          `Seguindo com a versão ${this.publicado.versao}.`,
      );
    }
  }
}
