import { z } from 'zod';
import {
  ACOES_DE_ATALHO,
  ehAcaoDeAtalho,
  ehPreferenciaDeMesa,
  ehBorderValido,
  ehPetValido,
  ehPlaymatValido,
  ehSleeveValido,
  ehTeclaDeAtalho,
  ehTitleValido,
} from '@aethertable/shared-types';

/**
 * users.dto.ts — validação de borda do perfil.
 *
 * `PATCH /users/me` recebia `{ username?, displayName?, language? }` como
 * anotação de tipo e nada mais. Em runtime aceitava qualquer coisa, e o valor
 * ia direto para `prisma.user.update`.
 *
 * O campo perigoso é o `username`: ele vira URL pública (`/u/[username]`) e
 * aparece no chat da mesa. Sem regra, dava para gravar um username com barra,
 * com espaço, com caractere de controle, ou com 10 mil letras — que quebra a
 * rota de perfil, embaralha o layout do log e ainda serve de vetor para
 * confundir jogador (`admin`, `Fulano ` com espaço à direita).
 *
 * A regra aqui é a MESMA do cadastro (`auth.dto.ts`). Tinha de ser: não faz
 * sentido barrar um nome no registro e aceitá-lo na edição de perfil — quem
 * quisesse o nome proibido era só se cadastrar e renomear em seguida.
 */

/** Idêntico ao RegisterDto: mesma porta, mesma tranca. */
const username = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Use apenas letras, números, ponto, hífen ou underline');

/**
 * ─── OS IDS DE COSMÉTICO SÃO VALIDADOS CONTRA O CATÁLOGO ───────────────────
 *
 * A coluna é `VarChar(48)` sem foreign key, porque o catálogo é fechado e
 * versionado em CÓDIGO (`shared-types/cosmetics.ts`, DOC-060 §1.1) — não há
 * tabela para referenciar. Sem esta validação, a coluna aceitaria qualquer
 * string e o cliente desenharia o padrão em silêncio: o jogador equiparia algo,
 * o servidor gravaria, e a mesa mostraria outra coisa.
 *
 * `null` é explicitamente permitido: significa "voltar ao padrão".
 */
const idDeCosmetico = (valido: (id: string) => boolean, rotulo: string) =>
  z
    .string()
    .trim()
    .max(48)
    .refine(valido, { message: `Não existe ${rotulo} com esse id no catálogo.` })
    .nullable()
    .optional();

/**
 * ─── OS ATALHOS SÃO VALIDADOS CONTRA O CATÁLOGO DE AÇÕES ───────────────────
 *
 * `user_preferences.keybindings` é JSONB, o que significa que o Postgres aceita
 * qualquer coisa: um array, uma string, um objeto de 40 mil chaves. Sem esta
 * validação a coluna seria armazenamento livre exposto num PATCH autenticado.
 *
 * A CHAVE é validada com rigor — tem de ser uma ação que existe
 * (`ACOES_DE_ATALHO`), porque uma chave desconhecida é peso morto que o cliente
 * vai ignorar para sempre.
 *
 * O VALOR é validado por abuso, não por gramática: a forma canônica de uma
 * tecla (`'ctrl+z'`, `'P'`, `'='`) é definida no cliente por `normalizarTecla`,
 * e reimplementar essa gramática aqui criaria duas fontes da verdade que
 * envelhecem separado. E o modo de falhar é seguro, diferente de um id de
 * cosmético: uma tecla que não corresponde a tecla nenhuma simplesmente nunca
 * dispara. O que precisa ser barrado é o que ocupa banco — string enorme,
 * espaço, caractere de controle. Ver `ehTeclaDeAtalho`.
 */
const keybindings = z
  .record(z.string(), z.string())
  .refine((mapa) => Object.keys(mapa).length <= ACOES_DE_ATALHO.length, {
    message: 'Mais atalhos do que existem ações mapeáveis.',
  })
  .refine((mapa) => Object.keys(mapa).every(ehAcaoDeAtalho), {
    message: 'Há uma ação de atalho que não existe no catálogo.',
  })
  .refine((mapa) => Object.values(mapa).every(ehTeclaDeAtalho), {
    message: 'Há uma tecla com formato inválido.',
  });

/**
 * ─── AS PREFERÊNCIAS DE MESA SEGUEM A MESMA REGRA DOS ATALHOS ──────────────
 *
 * A coluna é JSONB, então o Postgres aceitaria um array de mil posições. O que
 * se valida aqui é ABUSO: chave que não existe no contrato e objeto maior que
 * o contrato. Os VALORES não são validados campo a campo de propósito — quem
 * decide o que é um `fatorCarta` aceitável é
 * `normalizarPreferenciasDeMesa`, e reimplementar essa faixa aqui criaria duas
 * fontes da verdade que envelhecem separado.
 *
 * E o modo de falhar é seguro: um valor estranho que passasse por aqui é
 * corrigido pelo normalizador na leitura, do lado do cliente. Diferente de um
 * id de cosmético, preferência errada não concede nada a ninguém.
 */
const preferenciasDeMesa = z.record(z.string(), z.unknown()).refine(ehPreferenciaDeMesa, {
  message: 'Há uma preferência de mesa que não existe no contrato.',
});

export const AtualizarPerfilDto = z
  .object({
    username: username.optional(),
    sleeveId: idDeCosmetico(ehSleeveValido, 'protetor'),
    playmatId: idDeCosmetico(ehPlaymatValido, 'tapete'),
    borderId: idDeCosmetico(ehBorderValido, 'borda'),
    titleId: idDeCosmetico(ehTitleValido, 'título'),
    petId: idDeCosmetico(ehPetValido, 'mascote'),
    cosmeticosDeOponentes: z.boolean().optional(),
    /** Mapa completo ação → tecla. Ver o comentário de `keybindings`. */
    keybindings: keybindings.optional(),
    /** Objeto completo de preferências da mesa. Ver o comentário acima. */
    preferenciasDeMesa: preferenciasDeMesa.optional(),
    /** Nome de exibição é livre, mas limitado — cabe acento e espaço. */
    displayName: z.string().trim().min(1).max(48).optional(),
    /** Código de idioma curto (`pt-BR`, `en`), não texto livre. */
    language: z
      .string()
      .trim()
      .min(2)
      .max(10)
      .regex(/^[a-zA-Z]{2}(-[a-zA-Z]{2})?$/)
      .optional(),
  })
  // Um PATCH vazio faria um UPDATE sem mudança nenhuma no banco. Barrar aqui
  // evita a escrita inútil e devolve 400 em vez de 200 mentindo que salvou.
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para atualizar' });

export type AtualizarPerfilDto = z.infer<typeof AtualizarPerfilDto>;

/** Perfil público: o parâmetro da URL passa pela mesma regra do username. */
export const UsernameParam = username;
