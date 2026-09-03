import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { Papeis, PapeisGuard, type RequisicaoAdmin } from './papeis.js';
import { AuditoriaService } from './auditoria.service.js';
import { AdminUsuariosService } from './admin-usuarios.service.js';
import { AdminDenunciasService } from './admin-denuncias.service.js';
import { AdminSistemaService } from './admin-sistema.service.js';
import {
  AtualizarCosmeticoDto,
  BuscarUsuariosDto,
  CriarCosmeticoDto,
  InventarioDto,
  ListarAuditoriaDto,
  ListarDenunciasDto,
  MotivoDto,
  MudarFlagDto,
  MudarPapelDto,
  ResolverDenunciaDto,
  SuspenderDto,
} from './admin.dto.js';

/**
 * admin.controller.ts — o backoffice (DOC-061).
 *
 * ─── A HIERARQUIA ESTÁ NOS DECORADORES, E É O CHECKLIST DO DOCUMENTO ───────
 *
 * §6 exige: "Moderadores não têm acesso às páginas de Ferramentas do Sistema
 * nem Gestão de Cosméticos". Aqui isso é `@Papeis(Role.MOD)` no que o
 * moderador pode e a AUSÊNCIA do decorador no resto — porque o `PapeisGuard`
 * trata rota sem decorador como ADMIN. O padrão seguro é o restritivo: uma rota
 * nova nasce fechada, e abrir exige um ato explícito.
 *
 * ─── POR QUE O LIMITE DE REQUISIÇÕES É ESTREITO ────────────────────────────
 *
 * O balde global (10 req/5 s) é para navegação de jogador. Aqui ele é AINDA
 * mais apertado nas ações destrutivas: um script com um token administrativo
 * roubado não deve conseguir banir mil contas em um minuto. As leituras ficam
 * folgadas — o painel faz várias por tela.
 */

const LEITURA = { curto: { limit: 40, ttl: 5_000 }, longo: { limit: 300, ttl: 60_000 } };
const ESCRITA = { curto: { limit: 10, ttl: 5_000 }, longo: { limit: 60, ttl: 60_000 } };

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, PapeisGuard)
export class AdminController {
  constructor(
    private readonly usuarios: AdminUsuariosService,
    private readonly denuncias: AdminDenunciasService,
    private readonly sistema: AdminSistemaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ─── Sessão ────────────────────────────────────────────────────────────────

  /**
   * Quem sou eu aqui.
   *
   * O frontend precisa disto ANTES de desenhar o painel: sem uma resposta
   * autoritativa do servidor, a única alternativa seria confiar no `role` que o
   * cliente guardou no login — que é justamente o dado que uma despromoção
   * torna obsoleto. Esta rota é a fonte da verdade, e ela passa pelo guardião.
   */
  @Get('eu')
  @Papeis(Role.MOD)
  @Throttle(LEITURA)
  @ApiOperation({ summary: 'Confirma o papel do administrador autenticado' })
  eu(@Request() req: RequisicaoAdmin) {
    return { id: req.autor.id, username: req.autor.username, papel: req.autor.role };
  }

  @Get('visao-geral')
  @Papeis(Role.MOD)
  @Throttle(LEITURA)
  @ApiOperation({ summary: 'Números da tela inicial do painel' })
  visaoGeral() {
    return this.sistema.visaoGeral();
  }

  // ─── Usuários (DOC-061 §2) ─────────────────────────────────────────────────

  @Get('usuarios')
  @Papeis(Role.MOD)
  @Throttle(LEITURA)
  @ApiOperation({ summary: 'Busca contas por username, email ou id' })
  buscarUsuarios(@Query(new ZodValidationPipe(BuscarUsuariosDto)) dto: BuscarUsuariosDto) {
    return this.usuarios.buscar(dto);
  }

  @Get('usuarios/:id')
  @Papeis(Role.MOD)
  @Throttle(LEITURA)
  @ApiOperation({ summary: 'Ficha completa de uma conta' })
  detalharUsuario(@Param('id', ParseUUIDPipe) id: string) {
    return this.usuarios.detalhar(id);
  }

  @Post('usuarios/:id/suspender')
  @Papeis(Role.MOD)
  @Throttle(ESCRITA)
  @ApiOperation({ summary: 'Suspende a conta por N dias' })
  suspender(
    @Request() req: RequisicaoAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(SuspenderDto)) dto: SuspenderDto,
  ) {
    return this.usuarios.suspender(req, id, dto);
  }

  @Post('usuarios/:id/reativar')
  @Papeis(Role.MOD)
  @Throttle(ESCRITA)
  @ApiOperation({ summary: 'Remove a suspensão' })
  reativar(
    @Request() req: RequisicaoAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(MotivoDto)) dto: MotivoDto,
  ) {
    return this.usuarios.removerSuspensao(req, id, dto);
  }

  @Post('usuarios/:id/banir')
  @Papeis(Role.MOD)
  @Throttle(ESCRITA)
  @ApiOperation({ summary: 'Banimento por soft delete — dispara o expurgo de 30 dias' })
  banir(
    @Request() req: RequisicaoAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(MotivoDto)) dto: MotivoDto,
  ) {
    return this.usuarios.banir(req, id, dto);
  }

  /** Restaurar é de ADMIN: desfazer a punição de um colega não é ato de par. */
  @Post('usuarios/:id/restaurar')
  @Throttle(ESCRITA)
  @ApiOperation({ summary: 'Desfaz o banimento' })
  restaurar(
    @Request() req: RequisicaoAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(MotivoDto)) dto: MotivoDto,
  ) {
    return this.usuarios.restaurar(req, id, dto);
  }

  @Patch('usuarios/:id/papel')
  @Throttle(ESCRITA)
  @ApiOperation({ summary: 'Altera o papel para USER, MOD ou ADMIN' })
  mudarPapel(
    @Request() req: RequisicaoAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(MudarPapelDto)) dto: MudarPapelDto,
  ) {
    return this.usuarios.mudarPapel(req, id, dto);
  }

  @Post('usuarios/:id/inventario')
  @Throttle(ESCRITA)
  @ApiOperation({ summary: 'Concede um cosmético (prêmio de campeonato)' })
  conceder(
    @Request() req: RequisicaoAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(InventarioDto)) dto: InventarioDto,
  ) {
    return this.usuarios.concederCosmetico(req, id, dto);
  }

  @Delete('usuarios/:id/inventario')
  @Throttle(ESCRITA)
  @ApiOperation({ summary: 'Retira um cosmético do inventário' })
  revogar(
    @Request() req: RequisicaoAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(InventarioDto)) dto: InventarioDto,
  ) {
    return this.usuarios.revogarCosmetico(req, id, dto);
  }

  // ─── Denúncias (DOC-061 §4) ────────────────────────────────────────────────

  @Get('denuncias')
  @Papeis(Role.MOD)
  @Throttle(LEITURA)
  @ApiOperation({ summary: 'Fila de denúncias' })
  listarDenuncias(@Query(new ZodValidationPipe(ListarDenunciasDto)) dto: ListarDenunciasDto) {
    return this.denuncias.listar(dto);
  }

  @Get('denuncias/resumo')
  @Papeis(Role.MOD)
  @Throttle(LEITURA)
  @ApiOperation({ summary: 'Contagem de denúncias por status' })
  resumoDenuncias() {
    return this.denuncias.resumo();
  }

  @Get('denuncias/:id')
  @Papeis(Role.MOD)
  @Throttle(LEITURA)
  @ApiOperation({ summary: 'Denúncia com evidência e histórico do denunciado' })
  detalharDenuncia(@Param('id', ParseUUIDPipe) id: string) {
    return this.denuncias.detalhar(id);
  }

  @Post('denuncias/:id/assumir')
  @Papeis(Role.MOD)
  @Throttle(ESCRITA)
  @ApiOperation({ summary: 'Marca em análise' })
  assumirDenuncia(@Request() req: RequisicaoAdmin, @Param('id', ParseUUIDPipe) id: string) {
    return this.denuncias.assumir(req, id);
  }

  @Post('denuncias/:id/resolver')
  @Papeis(Role.MOD)
  @Throttle(ESCRITA)
  @ApiOperation({ summary: 'Encerra como resolvida ou improcedente' })
  resolverDenuncia(
    @Request() req: RequisicaoAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ResolverDenunciaDto)) dto: ResolverDenunciaDto,
  ) {
    return this.denuncias.resolver(req, id, dto);
  }

  // ─── Cosméticos (DOC-061 §3) — ADMIN apenas ───────────────────────────────

  @Get('cosmeticos')
  @Throttle(LEITURA)
  @ApiOperation({ summary: 'Catálogo em código e itens registrados como concedíveis' })
  listarCosmeticos() {
    return this.sistema.listarCosmeticos();
  }

  @Post('cosmeticos')
  @Throttle(ESCRITA)
  @ApiOperation({ summary: 'Registra um item do catálogo como concedível' })
  criarCosmetico(
    @Request() req: RequisicaoAdmin,
    @Body(new ZodValidationPipe(CriarCosmeticoDto)) dto: CriarCosmeticoDto,
  ) {
    return this.sistema.criarCosmetico(req, dto);
  }

  @Patch('cosmeticos/:id')
  @Throttle(ESCRITA)
  @ApiOperation({ summary: 'Altera nome, tier mínimo ou disponibilidade' })
  atualizarCosmetico(
    @Request() req: RequisicaoAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AtualizarCosmeticoDto)) dto: AtualizarCosmeticoDto,
  ) {
    return this.sistema.atualizarCosmetico(req, id, dto);
  }

  @Delete('cosmeticos/:id')
  @Throttle(ESCRITA)
  @ApiOperation({ summary: 'Desregistra um item que ninguém possui' })
  removerCosmetico(@Request() req: RequisicaoAdmin, @Param('id', ParseUUIDPipe) id: string) {
    return this.sistema.removerCosmetico(req, id);
  }

  // ─── Ferramentas do sistema (DOC-061 §5) — ADMIN apenas ───────────────────

  @Get('flags')
  @Throttle(LEITURA)
  @ApiOperation({ summary: 'Interruptores globais de plataforma' })
  listarFlags() {
    return this.sistema.listarFlags();
  }

  @Patch('flags/:key')
  @Throttle(ESCRITA)
  @ApiOperation({ summary: 'Liga ou desliga um interruptor (kill switch)' })
  mudarFlag(
    @Request() req: RequisicaoAdmin,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(MudarFlagDto)) dto: MudarFlagDto,
  ) {
    return this.sistema.mudarFlag(req, key, dto);
  }

  @Post('cache-de-cartas/limpar')
  @Throttle({ curto: { limit: 2, ttl: 60_000 }, longo: { limit: 5, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Esvazia o cache da Scryfall (após spoilers de coleção)' })
  limparCache(@Request() req: RequisicaoAdmin) {
    return this.sistema.limparCacheDeCartas(req);
  }

  // ─── Auditoria (DOC-061 §6) ───────────────────────────────────────────────

  /**
   * O histórico é legível por MOD de propósito.
   *
   * Um log que só o administrador vê não segura o administrador. Moderadores
   * lerem as ações uns dos outros — e as do admin — é o que transforma o
   * registro em prestação de contas em vez de arquivo morto.
   */
  @Get('auditoria')
  @Papeis(Role.MOD)
  @Throttle(LEITURA)
  @ApiOperation({ summary: 'Histórico inalterável de ações administrativas' })
  listarAuditoria(@Query(new ZodValidationPipe(ListarAuditoriaDto)) dto: ListarAuditoriaDto) {
    return this.auditoria.listar({
      limite: dto.limite,
      ...(dto.cursor ? { cursor: dto.cursor } : {}),
      ...(dto.action ? { action: dto.action } : {}),
      ...(dto.actorId ? { actorId: dto.actorId } : {}),
      ...(dto.targetId ? { targetId: dto.targetId } : {}),
    });
  }
}
