import { Logger, type Provider } from '@nestjs/common';
import { ScryfallClient } from '@aethertable/scryfall-client';

/** Token de injeção do cliente único da Scryfall. */
export const SCRYFALL_CLIENT = Symbol('SCRYFALL_CLIENT');

/**
 * User-Agent de última instância.
 *
 * O `ScryfallClient` recusa subir sem User-Agent — e está certo, porque a
 * Scryfall bloqueia quem não se identifica. Mas derrubar o boot da API inteira
 * por causa de uma variável de ambiente ausente troca "as cartas não carregam"
 * por "nada carrega". O fallback mantém a API de pé, ainda identificável, e o
 * aviso no log diz o que corrigir.
 */
const USER_AGENT_PADRAO = 'AetherTable/1.0 (+https://github.com/aethertable)';

export const scryfallClientProvider: Provider = {
  provide: SCRYFALL_CLIENT,
  useFactory: (): ScryfallClient => {
    const configurado = process.env.SCRYFALL_USER_AGENT?.trim();

    if (!configurado) {
      new Logger('ScryfallClient').warn(
        'SCRYFALL_USER_AGENT ausente — usando um User-Agent genérico. ' +
          'Preencha a variável (DOC-035 §3): a Scryfall pode limitar tráfego não identificado.',
      );
    }

    return new ScryfallClient({
      userAgent: configurado || USER_AGENT_PADRAO,
      // Permite apontar para um espelho/proxy corporativo sem tocar no código.
      baseUrl: process.env.SCRYFALL_API_URL?.trim() || undefined,
    });
  },
};
