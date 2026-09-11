import {
  normalizarCosmeticosAutorais,
  registrarCosmeticosAutorais,
  type CosmeticoAutoralBruto,
} from '@aethertable/shared-types';
import { config } from '../config';

/**
 * catalogo-de-cosmeticos.ts — manter o catálogo do servidor de jogo em dia.
 *
 * ─── POR QUE O SERVIDOR DE JOGO PRECISA DISSO ──────────────────────────────
 *
 * `intents/schemas.ts` valida `sleeveId` e companhia com `ehSleeveValido`, e
 * esse `refine` é SÍNCRONO — uma intenção não pode esperar uma consulta de
 * rede, e todo handler deste servidor é síncrono por regra. Então o catálogo
 * tem de estar em memória ANTES da intenção chegar, e alguém tem de mantê-lo
 * atualizado por fora do caminho da requisição. É o que este módulo faz.
 *
 * ─── A FALHA É FECHADA, E ISSO TEM UM CUSTO VISÍVEL ────────────────────────
 *
 * Se a API Core estiver fora do ar, este servidor fica com o catálogo do
 * bundle e RECUSA todo cosmético autoral com "fora do catalogo". Um jogador
 * com um item autoral equipado entra na mesa com o visual padrão, e volta ao
 * normal no ciclo seguinte.
 *
 * A alternativa — aceitar qualquer id quando não dá para verificar — trocaria
 * um problema visual temporário por um buraco permanente: bastaria derrubar a
 * API Core para equipar o que quisesse, inclusive itens de apoiador sem ser
 * apoiador. Entre desenhar errado e não checar, desenhar errado é melhor.
 *
 * ─── O INTERVALO ───────────────────────────────────────────────────────────
 *
 * Um minuto. É o atraso máximo entre criar um cosmético no backoffice e
 * conseguir equipá-lo numa mesa — imperceptível na operação real, e barato o
 * bastante para não valer uma infraestrutura de invalidação (ver o cabeçalho
 * de `catalogo.service.ts` na API Core).
 */

const INTERVALO_MS = 60_000;

/**
 * Antes do PRIMEIRO sucesso, tenta de novo rápido.
 *
 * Este servidor e a API Core sobem juntos — no `pnpm dev` e num deploy que
 * reinicia os dois — e quem termina primeiro é sorteio. A primeira tentativa
 * falhando é o caso NORMAL, não a exceção, e esperar o ciclo cheio deixaria o
 * primeiro minuto de vida do servidor recusando todo cosmético autoral.
 *
 * Depois que uma sincronização der certo, a pressa deixa de fazer sentido: aí
 * a API está no ar e o que muda é só o conteúdo, na cadência do minuto.
 */
const INTERVALO_INICIAL_MS = 3_000;
const TENTATIVAS_INICIAIS = 10;

/** Versão publicada que já aplicamos. `-1` = nunca sincronizou. */
let versaoAplicada = -1;
let timer: NodeJS.Timeout | null = null;
/** Vira `true` na primeira resposta boa da API Core. */
let jaSincronizou = false;

interface RespostaDoCatalogo {
  versao: number;
  itens: Array<{ familia: unknown; item: CosmeticoAutoralBruto }>;
}

/**
 * Busca e aplica. Devolve quantos itens entraram, ou `null` se nada mudou ou
 * a busca falhou — o chamador só usa isso para o log.
 */
export async function sincronizarCatalogo(): Promise<number | null> {
  try {
    const controle = new AbortController();
    // Sem timeout, uma API Core pendurada seguraria este fetch indefinidamente
    // e o ciclo seguinte se empilharia em cima dele.
    const corte = setTimeout(() => controle.abort(), 8_000);
    const res = await fetch(`${config.BACKEND_CORE_URL}/api/v1/cosmeticos/catalogo`, {
      signal: controle.signal,
    });
    clearTimeout(corte);

    if (!res.ok) {
      console.warn(`[catalogo] API Core respondeu ${res.status}; mantendo o catalogo atual.`);
      return null;
    }

    const corpo = (await res.json()) as RespostaDoCatalogo;
    if (typeof corpo?.versao !== 'number' || !Array.isArray(corpo.itens)) {
      console.warn('[catalogo] resposta em formato inesperado; mantendo o catalogo atual.');
      return null;
    }
    jaSincronizou = true;
    if (corpo.versao === versaoAplicada) return null;

    /**
     * Normaliza de novo, do lado de cá.
     *
     * A API Core já validou — mas este processo é quem RECUSA ou ACEITA a
     * intenção de equipar, e confiar na validação de outro processo significa
     * que um bug lá vira um buraco aqui. O custo é um laço sobre algumas
     * dezenas de itens por minuto.
     */
    const itens = normalizarCosmeticosAutorais(
      corpo.itens.map((i) => ({ ...i.item, familia: i.familia })),
    );
    const aceitos = registrarCosmeticosAutorais(itens);
    versaoAplicada = corpo.versao;

    console.log(`[catalogo] versao ${corpo.versao}: ${aceitos} cosmetico(s) autoral(is) ativo(s).`);
    return aceitos;
  } catch (erro) {
    console.warn(
      `[catalogo] falha ao sincronizar: ${erro instanceof Error ? erro.message : String(erro)}. ` +
        'Mantendo o catalogo em memoria.',
    );
    return null;
  }
}

/**
 * Liga o ciclo. Chamado uma vez na subida.
 *
 * `unref` para o timer não segurar o processo de pé: um servidor que terminou
 * de encerrar não deve ficar mais um minuto vivo esperando o próximo tique.
 */
export function iniciarSincronizacaoDoCatalogo(): void {
  if (timer) return;

  let tentativas = 0;
  const tique = async (): Promise<void> => {
    await sincronizarCatalogo();
    tentativas += 1;

    // Passa para a cadência normal assim que a API responder — ou quando as
    // tentativas rápidas se esgotarem, para um serviço que está fora do ar de
    // verdade não ser consultado a cada três segundos para sempre.
    const proximo =
      jaSincronizou || tentativas >= TENTATIVAS_INICIAIS ? INTERVALO_MS : INTERVALO_INICIAL_MS;

    timer = setTimeout(() => void tique(), proximo);
    timer.unref?.();
  };

  void tique();
}

/** Só para teste: desliga o ciclo e esquece o que foi aplicado. */
export function pararSincronizacaoDoCatalogo(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  versaoAplicada = -1;
  jaSincronizou = false;
}
