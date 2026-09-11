import { z } from 'zod';
import {
  AdminAction,
  CosmeticType,
  ReportReason,
  ReportStatus,
  Role,
  SupporterTier,
} from '@prisma/client';

/**
 * admin.dto.ts — a fronteira de entrada do backoffice.
 *
 * ─── POR QUE A JUSTIFICATIVA É OBRIGATÓRIA ─────────────────────────────────
 *
 * Suspender, banir e mudar papel exigem `motivo` com pelo menos 8 caracteres.
 * Não é burocracia: o log de auditoria (DOC-061 §6) sem o porquê responde
 * "quem e quando" e deixa de fora a única coisa que outro moderador precisa
 * saber ao revisar a decisão seis meses depois. Um campo opcional aqui viraria
 * um campo vazio em 90% das linhas.
 *
 * ─── E POR QUE O TETO DE SUSPENSÃO É 365 DIAS ─────────────────────────────
 *
 * Acima de um ano não é suspensão, é banimento — e banimento tem outro fluxo,
 * com soft delete e expurgo em 30 dias. Sem o teto, "suspender por 9999 dias"
 * seria um banimento que escapa do fluxo de LGPD.
 */

const Motivo = z.string().trim().min(8, 'Descreva o motivo com pelo menos 8 caracteres.').max(500);

const Uuid = z.string().uuid();

// ─── Usuários ────────────────────────────────────────────────────────────────

export const BuscarUsuariosDto = z.object({
  /** Casa por username, email ou id. Vazio devolve a lista mais recente. */
  q: z.string().trim().max(120).optional(),
  papel: z.nativeEnum(Role).optional(),
  /** `true` mostra também contas apagadas — o padrão é esconder. */
  incluirApagados: z.coerce.boolean().optional(),
  apenasSuspensos: z.coerce.boolean().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  cursor: Uuid.optional(),
});
export type BuscarUsuariosDto = z.infer<typeof BuscarUsuariosDto>;

export const SuspenderDto = z.object({
  dias: z.coerce.number().int().min(1).max(365),
  motivo: Motivo,
});
export type SuspenderDto = z.infer<typeof SuspenderDto>;

export const MotivoDto = z.object({ motivo: Motivo });
export type MotivoDto = z.infer<typeof MotivoDto>;

export const MudarPapelDto = z.object({
  papel: z.nativeEnum(Role),
  motivo: Motivo,
});
export type MudarPapelDto = z.infer<typeof MudarPapelDto>;

/**
 * ─── O TIER E O QUE DE FATO GOVERNA O EQUIPAMENTO ────────────────────────────
 *
 * O catalogo de cosmeticos marca itens como FREE ou APOIADOR, e ate agora essa
 * marca nao valia nada: o cadeado da interface era decorativo e o backend
 * gravava o que chegasse.
 *
 * Enquanto nao houver integracao de pagamento — nao ha nenhuma no repositorio —
 * o direito e concedido aqui, com motivo e trilha de auditoria como qualquer
 * outra acao do backoffice.
 */
export const MudarTierDto = z.object({
  tier: z.nativeEnum(SupporterTier),
  motivo: Motivo,
});
export type MudarTierDto = z.infer<typeof MudarTierDto>;

/**
 * ─── O ADMIN REDEFINE, MAS NAO ESCOLHE ──────────────────────────────────────
 *
 * O corpo tem so o motivo: a senha nova e GERADA pelo servidor e devolvida uma
 * unica vez na resposta.
 *
 * Deixar o admin digitar a senha seria pior de tres formas ao mesmo tempo:
 * ele escolheria algo fraco e memorizavel para conseguir ditar por telefone;
 * a senha passaria pelo corpo da requisicao, pelo log do proxy e pelo campo do
 * formulario dele; e ele ficaria SABENDO a senha de outra pessoa por tempo
 * indeterminado — que e exatamente o que um reset deve evitar.
 *
 * Gerada, ela e forte por construcao, aparece uma vez e some.
 */
export const RedefinirSenhaDto = z.object({ motivo: Motivo });
export type RedefinirSenhaDto = z.infer<typeof RedefinirSenhaDto>;

/**
 * ─── EXCLUSAO DEFINITIVA EXIGE DIGITAR O USERNAME ───────────────────────────
 *
 * `banir` e soft delete e tem volta (`restaurar`). Isto NAO tem: apaga a linha
 * e, em cascata, os decks, as preferencias e o inventario.
 *
 * A confirmacao por digitacao existe porque o custo do erro e assimetrico. Um
 * clique errado em "suspender" se desfaz num clique; um clique errado aqui nao
 * se desfaz de jeito nenhum — e as duas acoes moram na mesma tela, a uma linha
 * de distancia uma da outra.
 */
export const ExcluirDefinitivoDto = z.object({
  motivo: Motivo,
  /** Tem de bater com o username do alvo. Conferido no service. */
  confirmacao: z.string().min(1).max(32),
});
export type ExcluirDefinitivoDto = z.infer<typeof ExcluirDefinitivoDto>;

export const InventarioDto = z.object({
  /** Id do item no catálogo de código (`shared-types/cosmetics.ts`). */
  cosmeticoId: Uuid,
  motivo: Motivo,
});
export type InventarioDto = z.infer<typeof InventarioDto>;

// ─── Cosméticos ──────────────────────────────────────────────────────────────

/**
 * ─── NÃO EXISTE CAMPO DE URL DE IMAGEM, E ISSO É DELIBERADO ────────────────
 *
 * DOC-061 §3.1 pede "URL da Imagem (upload via bucket S3/Cloudflare R2)".
 * DOC-060 §1.1 proíbe: o catálogo é FECHADO e sem upload, por dois riscos que
 * moderação reativa não cobre — propriedade intelectual da WotC e conteúdo
 * sensível numa mesa que pode ter menores. E DOC-060 é a decisão que o código
 * implementa: os cosméticos são PROCEDURAIS, descritos por cores e um nome de
 * padrão, desenhados pelo cliente.
 *
 * Os dois documentos se contradizem, e este DTO resolve a favor do mais
 * restritivo. O que o painel administra é a DISPONIBILIDADE de itens que já
 * existem no catálogo de código — tier mínimo, ativo/inativo, e a concessão
 * manual a um jogador (o "prêmio de campeonato" de §2). Arte nova entra por
 * pull request em `shared-types/cosmetics.ts`, onde passa por revisão.
 *
 * `catalogoId` é validado contra o catálogo em código: o painel não consegue
 * registrar um item que o cliente não saberia desenhar.
 */
export const CriarCosmeticoDto = z.object({
  /** Id no catálogo de código — `aether-classic`, `mesa-padrao`… */
  catalogoId: z.string().trim().min(1).max(64),
  tipo: z.nativeEnum(CosmeticType),
  nome: z.string().trim().min(1).max(64),
  minTier: z.coerce.number().int().min(0).max(10).default(0),
  ativo: z.coerce.boolean().default(true),
});
export type CriarCosmeticoDto = z.infer<typeof CriarCosmeticoDto>;

export const AtualizarCosmeticoDto = z.object({
  nome: z.string().trim().min(1).max(64).optional(),
  minTier: z.coerce.number().int().min(0).max(10).optional(),
  ativo: z.coerce.boolean().optional(),
});
export type AtualizarCosmeticoDto = z.infer<typeof AtualizarCosmeticoDto>;

// ─── Denúncias ───────────────────────────────────────────────────────────────

export const ListarDenunciasDto = z.object({
  status: z.nativeEnum(ReportStatus).optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  cursor: Uuid.optional(),
});
export type ListarDenunciasDto = z.infer<typeof ListarDenunciasDto>;

export const ResolverDenunciaDto = z.object({
  /** `RESOLVED` = punição aplicada; `DISMISSED` = denúncia inválida. */
  status: z.enum([ReportStatus.RESOLVED, ReportStatus.DISMISSED]),
  resolucao: z.string().trim().min(4).max(1000),
});
export type ResolverDenunciaDto = z.infer<typeof ResolverDenunciaDto>;

/**
 * Denúncia criada por um JOGADOR (não pelo painel).
 *
 * `snapshot` é a evidência: as últimas linhas de log e chat, capturadas pelo
 * cliente no momento do clique. Precisa ser copiada porque o estado da sala
 * vive na RAM do game node (ADR-006) e desaparece quando a partida acaba —
 * sem isso, toda denúncia chegaria ao moderador sem nada para analisar.
 *
 * O teto de 60 linhas e 400 caracteres por linha é o que impede a rota de virar
 * um canal de upload de texto arbitrário para o banco.
 */
export const CriarDenunciaDto = z.object({
  denunciadoId: Uuid,
  motivo: z.nativeEnum(ReportReason),
  detalhes: z.string().trim().max(1000).optional(),
  roomCode: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{4,6}$/, 'Código de sala inválido.')
    .optional(),
  snapshot: z
    .array(
      z.object({
        em: z.number().int().nonnegative().optional(),
        autor: z.string().max(64).optional(),
        tipo: z.string().max(24).optional(),
        texto: z.string().max(400),
      }),
    )
    .max(60)
    .default([]),
});
export type CriarDenunciaDto = z.infer<typeof CriarDenunciaDto>;

// ─── Sistema ─────────────────────────────────────────────────────────────────

export const MudarFlagDto = z.object({
  ligado: z.coerce.boolean(),
  nota: z.string().trim().max(300).optional(),
});
export type MudarFlagDto = z.infer<typeof MudarFlagDto>;

export const ListarAuditoriaDto = z.object({
  action: z.nativeEnum(AdminAction).optional(),
  actorId: Uuid.optional(),
  targetId: z.string().trim().max(64).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  cursor: Uuid.optional(),
});
export type ListarAuditoriaDto = z.infer<typeof ListarAuditoriaDto>;
