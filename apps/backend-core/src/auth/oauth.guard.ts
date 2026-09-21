/**
 * oauth.guard.ts — a tranca antes do Passport, e o redirect quando algo falha.
 *
 * Dois problemas do mesmo caminho, resolvidos lado a lado porque um sem o outro
 * não serve:
 *
 *  1. `GET /auth/google` num ambiente sem `GOOGLE_CLIENT_ID` respondia erro 500
 *     do Passport (`Unknown authentication strategy`) — ou, pior, ia até o
 *     Google com `DUMMY_GOOGLE_CLIENT_ID` e o usuário lia "The OAuth client was
 *     not found" numa tela do Google.
 *  2. Qualquer falha no callback virava JSON de erro num navegador que esperava
 *     uma página. Ver `erro-de-oauth.ts`.
 */

import {
  ArgumentsHost,
  Catch,
  CanActivate,
  ExceptionFilter,
  Injectable,
  Logger,
  Type,
  mixin,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErroDeOAuth, type CodigoDeOAuth } from './erro-de-oauth.js';
import { provedorConfigurado, type Provedor } from './provedores.js';
import { urlDoFrontend } from './url-do-frontend.js';

/**
 * Recusa a rota quando o provedor não está configurado NESTE ambiente.
 *
 * Declarado ANTES do `AuthGuard` na lista de `@UseGuards`: os guards do Nest
 * rodam em ordem, então o Passport nunca chega a procurar uma estratégia que
 * não foi registrada.
 *
 * `mixin` existe porque o guard precisa saber de QUAL provedor se trata e o
 * Nest instancia guards pelo container de injeção — uma classe por provedor,
 * criada aqui, evita tanto um `SetMetadata` a mais quanto ler o provedor do
 * caminho da URL (que quebraria no dia em que a rota mudasse de forma).
 */
export function ExigirProvedorConfigurado(provedor: Provedor): Type<CanActivate> {
  @Injectable()
  class Guard implements CanActivate {
    constructor(readonly config: ConfigService) {}

    canActivate(): boolean {
      if (provedorConfigurado(this.config, provedor)) return true;
      throw new ErroDeOAuth('indisponivel', `Provedor ${provedor} sem credenciais neste ambiente.`);
    }
  }

  return mixin(Guard);
}

/** O mínimo de `express.Response` que o filtro usa. */
interface RespostaRedirecionavel {
  redirect(url: string): void;
}

/** O mínimo de `express.Request` que o filtro lê. */
interface RequisicaoComQuery {
  query?: Record<string, unknown>;
}

/**
 * Transforma QUALQUER falha das rotas de OAuth num redirect para a tela de
 * entrada, com um código que ela sabe traduzir.
 *
 * `@Catch()` sem argumento — pega tudo — é deliberado e não é preguiça. O que
 * NÃO pode acontecer neste caminho é o usuário terminar numa página de JSON: o
 * provedor pode falhar de formas que não estão previstas aqui (rede, resposta
 * malformada, biblioteca do provedor lançando string em vez de `Error`), e o
 * comportamento certo para todas é o mesmo. O detalhe real vai para o log.
 */
@Catch()
export class RedirecionarFalhaDeOAuth implements ExceptionFilter {
  private readonly logger = new Logger(RedirecionarFalhaDeOAuth.name);

  constructor(private readonly config: ConfigService) {}

  catch(excecao: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const requisicao = http.getRequest<RequisicaoComQuery>();

    const codigo = this.codigoDe(excecao, requisicao);

    this.logger.warn(
      `Login por OAuth interrompido (${codigo}): ${
        excecao instanceof Error ? excecao.message : String(excecao)
      }`,
    );

    const resposta = http.getResponse<RespostaRedirecionavel>();
    // A tela de entrada é a `/` — ver `app/page.tsx`. O código é o único dado
    // que atravessa; nenhuma mensagem do servidor vira texto na tela.
    resposta.redirect(`${urlDoFrontend(this.config)}/?erro=${codigo}`);
  }

  /**
   * "Cancelei" e "quebrou" precisam ser coisas diferentes na tela.
   *
   * Quando a pessoa clica em "Cancelar" na tela de autorização do provedor, ele
   * devolve o navegador ao nosso callback com `?error=access_denied` — e o
   * Passport trata isso como qualquer outra falha. Sem esta leitura, quem
   * desistiu do login por Google leria "não foi possível concluir o login. Tente
   * de novo", como se a culpa fosse do sistema, e provavelmente tentaria de novo.
   */
  private codigoDe(excecao: unknown, requisicao: RequisicaoComQuery): CodigoDeOAuth {
    if (excecao instanceof ErroDeOAuth) return excecao.codigo;

    const erroDoProvedor = requisicao.query?.['error'];
    if (erroDoProvedor === 'access_denied') return 'recusado';

    return 'falhou';
  }
}
