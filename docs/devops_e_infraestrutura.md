# Estratégia de DevOps e Infraestrutura

| Campo | Valor |
|---|---|
| **ID** | `DOC-053` |
| **Versão** | 1.1 |
| **Status** | Estável |
| **Última revisão** | 2026-08-20 |
| **Documentos relacionados** | [readme.md](readme.md) · [documento_de_arquitetura_de_software_sad.md](documento_de_arquitetura_de_software_sad.md) · [stack_tecnologico.md](stack_tecnologico.md) · [guia_de_configuracao_e_desenvolvimento.md](guia_de_configuracao_e_desenvolvimento.md) |

---

## 1. Ambientes

| Ambiente | Propósito | Dados | Quem acessa |
|---|---|---|---|
| **Local** | Desenvolvimento | Docker + seed | Desenvolvedor |
| **Preview** | Um por PR (frontend) | Aponta para staging | Time + revisores |
| **Staging** | Validação pré-release | Anonimizados / seed | Time |
| **Produção** | Usuários reais | Reais | Somente automação; acesso humano auditado |

Regra: **nenhum dado real em staging.** Testar com dados de usuário é vazamento por descuido.

---

## 2. Arquitetura de nuvem (produção)

```
                        ┌──────────────────────────────┐
                        │        Cloudflare            │
                        │  DNS · WAF · DDoS · CDN      │
                        │  rate limit de borda         │
                        └───┬──────────┬───────────┬───┘
                            │          │           │
              app.dominio   │  api.dominio  game-*.dominio
                            │          │           │
                   ┌────────▼──┐  ┌────▼──────┐  ┌─▼──────────────────┐
                   │  Vercel   │  │  Render / │  │  VPS dedicadas     │
                   │  Next.js  │  │  Railway  │  │  Colyseus          │
                   │  CDN      │  │  NestJS   │  │  (2+ nós)          │
                   │  Edge SSR │  │  autoscale│  │  sem autoscaling   │
                   └───────────┘  └──┬─────┬──┘  │  brutal            │
                                     │     │     └──┬──────────────┬──┘
                              ┌──────▼──┐ ┌▼────────▼──┐           │
                              │Postgres │ │   Redis    │◄──────────┘
                              │gerenciado│ │ presence · │  pub/sub
                              │+ réplica│ │ pubsub ·   │
                              └─────────┘ │ ratelimit  │
                                          └────────────┘
                   ┌──────────────────────┐
                   │  LiveKit Cloud (SFU) │
                   └──────────────────────┘
```

### 2.1 Componentes

| Componente | Serviço | Por quê | Escalonamento |
|---|---|---|---|
| **DNS & Edge Proxy** | **Cloudflare** | Proteção DDoS — primordial para WS/WebRTC —, CDN de imagens em cache e *rate limit* de borda | Automático |
| **Frontend** | **Vercel** | Ideal para Next.js: estáticos rápidos e Edge Functions para o SSR do lobby | Automático |
| **Backend REST** | **Render / Railway / AWS ECS** | *Stateless*; autoscaling por requisição/CPU | Automático, 2–10 instâncias |
| **State Servers (Colyseus)** | **VPS dedicadas** | Precisa de porta aberta e processo persistente. **Autoscaling agressivo é contraindicado**: matar um nó mata as salas dele | Manual / previsto |
| **Voice Server** | **LiveKit Cloud** | Alivia o peso de administrar SFUs de WebRTC, deixando o foco na aplicação | Automático |
| **Banco** | Postgres gerenciado (Neon/Supabase/RDS) | Backup e PITR prontos | Vertical + réplica de leitura |
| **Cache** | Redis gerenciado (Upstash) | Presence e *rate limit* | Vertical |

### 2.2 Nota crítica — escalabilidade do Colyseus

Para escalar instâncias do Colyseus horizontalmente, **cada nó Node.js precisa ser alcançável por uma
URL pública própria**. A conexão WebSocket tem de chegar exatamente ao processo que hospeda aquela
sala — não existe "balancear entre nós" depois de conectado.

**Implementação:**

| Peça | Função |
|---|---|
| `@colyseus/redis-presence` | Presença compartilhada entre nós |
| `@colyseus/redis-driver` | Descoberta: em qual nó está a sala `K7M2QX` |
| Endereço público por nó | `game-01.dominio`, `game-02.dominio`… |
| **`POST /rooms` devolve `wsUrl`** | O cliente recebe o endereço do nó **específico** e conecta direto |
| NGINX (quando usado) | Proxy reverso com `proxy_read_timeout` alto e `Upgrade`/`Connection` corretos para *keep-alive* |

**Antipadrão a evitar:** um *load balancer* HTTP genérico sem afinidade na frente dos game nodes. A
conexão vai para o nó errado e a sala não é encontrada.

```nginx
# exemplo de proxy para um nó de jogo
location / {
  proxy_pass http://127.0.0.1:2567;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header X-Real-IP $remote_addr;
  proxy_read_timeout 3600s;      # WebSocket é longo por natureza
  proxy_send_timeout 3600s;
}
```

### 2.3 Dimensionamento de referência

| Fase | Nós de jogo | Salas/nó | CCU suportado | API | Postgres |
|---|---|---|---|---|---|
| MVP | 1 × (2 vCPU, 4 GB) | ~40 | ~160 | 1 instância | Menor plano |
| V1 | 2 × (4 vCPU, 8 GB) | ~80 | ~640 | 2 instâncias | Plano médio |
| V2 | 4+ × (4 vCPU, 8 GB) | ~80 | ~2.500+ | Autoscale 2–10 | Médio + réplica |

Base do cálculo: ~8 MB de RAM por sala (`NFR-07`) e CPU dominada pela serialização com `@filter`
(`DOC-032` §7). Números a confirmar no teste de carga (`DOC-052` §3).

---

## 3. CI/CD

**Ferramenta:** GitHub Actions.

### 3.1 Pipeline de PR

```
push no PR
  ├─ 1. Lint + formatação            (< 2 min)
  ├─ 2. Type check (tsc --noEmit)    (< 2 min)
  ├─ 3. Testes unitários (Jest)      (< 3 min)
  ├─ 4. Testes de integração         (< 5 min)
  ├─ 5. E2E essencial (Playwright)   (< 8 min)
  ├─ 6. Auditoria de informação oculta (G1)   ← BLOQUEIA
  ├─ 7. npm audit + secret scanning  ← BLOQUEIA
  └─ 8. Build (frontend + serviços)
        └─ Preview na Vercel
```

Orçamento total: **< 15 min** (`DOC-052` §9.1).

### 3.2 Pipeline da `main`

```
merge na main
  ├─ Pipeline de PR completo
  ├─ Build de imagem Docker (backend-core, game-server)
  ├─ Push para o Container Registry (tag = SHA do commit)
  ├─ Deploy automático em STAGING
  ├─ Migrações do Prisma em staging
  ├─ Suíte completa + carga leve (50 conexões)
  └─ Aguarda aprovação manual → produção
```

### 3.3 Deploy em produção

| Serviço | Estratégia | Cuidado |
|---|---|---|
| **Frontend** | *Rolling* automático (Vercel) | Nenhum |
| **API Core** | *Rolling* com *health check* | Compatibilidade de contrato entre versões |
| **Game Server** | **Drenagem** (§3.4) | *Stateful* — não pode simplesmente reiniciar |
| **Migrações** | Antes do deploy da API, sempre compatíveis para trás | Coluna nova sempre nullable ou com default |

### 3.4 Deploy do game server com drenagem

```
1. Sobe nós com a nova versão (game-03, game-04)
2. Marca os antigos como draining = true
     → o matchmaker para de alocar salas neles
     → salas existentes continuam servidas
3. Envia evento roomClosing às salas antigas, informando a janela
4. Aguarda esvaziar (ou o timeout de 2 h)
5. Desliga os nós antigos
```

Custo aceito: durante a janela, roda o dobro de nós. É o preço de não interromper partidas em
andamento. Deploy do game server, por isso, é planejado — não é feito no meio da noite de sexta.

### 3.5 Rollback

| Serviço | Como |
|---|---|
| Frontend | *Rollback* instantâneo na Vercel |
| API Core | Redeploy da imagem anterior por SHA |
| Game Server | Idem, com nova drenagem |
| Banco | **Migração destrutiva é sempre em duas etapas** — nunca precisa de rollback de schema |

Regra de migração destrutiva: (1) release N adiciona a coluna nova e escreve nas duas; (2) release N+1
remove a antiga. Nunca as duas coisas no mesmo release.

---

## 4. Containers

```dockerfile
# apps/game-server/Dockerfile
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/game-server/package.json apps/game-server/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter game-server build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/apps/game-server/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
USER node
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:2567/health || exit 1
CMD ["node", "dist/index.js"]
```

| Prática | Motivo |
|---|---|
| *Multi-stage build* | Imagem final sem ferramentas de build |
| `USER node` | Nunca rodar como root |
| `--frozen-lockfile` | Build reprodutível |
| `HEALTHCHECK` | O orquestrador sabe quando o processo está pronto |
| Tag = SHA do commit | Rastreabilidade e rollback preciso |
| Sem `latest` em produção | Deploy determinístico |

---

## 5. Observabilidade

### 5.1 Métricas (Prometheus + Grafana)

| Métrica | Tipo | Alerta |
|---|---|---|
| `ws_connections_active` | Gauge | — |
| `ws_rooms_active` | Gauge | > 80 % da capacidade do nó |
| `ws_patch_duration_seconds` | Histogram | p95 > 20 ms |
| `ws_room_tick_duration_seconds` | Histogram | p95 > 30 ms |
| `ws_intents_rejected_total{reason}` | Counter | Aumento súbito (possível cliente modificado) |
| `ws_patch_bytes_total` | Counter | Projeção de custo |
| `ws_reconnections_total{result}` | Counter | Taxa de falha > 10 % |
| `process_resident_memory_bytes` | Gauge | > 85 % do limite |
| `http_request_duration_seconds` | Histogram | p95 > 500 ms |
| `http_requests_total{status}` | Counter | Taxa de 5xx > 1 % |
| `scryfall_requests_total{status}` | Counter | Taxa de 429 > 5 % |
| `db_query_duration_seconds` | Histogram | p95 > 100 ms |

### 5.2 Painéis do Grafana

| Painel | Conteúdo |
|---|---|
| **Visão geral** | CCU, salas ativas, taxa de erro, latência p95 |
| **Game servers** | Por nó: salas, memória, CPU, duração do *tick* |
| **API** | RPS, latência por rota, códigos de status |
| **Scryfall** | Volume, taxa de acerto de cache, 429 |
| **Banco** | Conexões, consultas lentas, tamanho |
| **Voz** | Participantes, banda, taxa de *fallback* TURN |
| **Negócio** | Partidas/dia, Time-to-Table, taxa de conclusão |

### 5.3 Logs

| Prática | Detalhe |
|---|---|
| Formato | JSON estruturado (`pino`) |
| Campos obrigatórios | `timestamp`, `level`, `service`, `requestId` ou `roomId` |
| Níveis | `error` (ação necessária), `warn` (anômalo), `info` (evento de negócio), `debug` (só em dev) |
| **Proibido logar** | Senha, token, corpo de autenticação, **identidade de carta em zona oculta** |
| Retenção | 30 dias em produção |
| Correlação | `requestId` propagado de ponta a ponta |

### 5.4 Erros e alertas

| Ferramenta | Uso |
|---|---|
| **Sentry** | Exceções de frontend e backend, com *release tracking* |
| Alertmanager | Alertas de métrica para Discord/Slack |
| Monitor externo (UptimeRobot) | Disponibilidade de fora da nuvem |

| Alerta | Severidade | Ação |
|---|---|---|
| Taxa de 5xx > 5 % | P1 | Acordar o plantão |
| Nó de jogo fora | P1 | Verificar; salas daquele nó foram perdidas |
| Postgres inacessível | P0 | Imediato |
| `ws_intents_rejected` disparando | P2 | Investigar possível abuso |
| Latência p95 > 300 ms | P2 | Investigar |
| Certificado expirando em 7 dias | P2 | Renovar |
| Voz com falha > 20 % | P2 | Verificar LiveKit |

---

## 6. Backup e recuperação de desastre

| Item | Política |
|---|---|
| *Full backup* do Postgres | Diário, retenção de 30 dias |
| PITR (WAL) | Contínuo, janela de 7 dias |
| **Teste de restauração** | **Mensal**, em ambiente isolado — backup não testado não é backup |
| RPO | ≤ 5 min |
| RTO | ≤ 1 h |
| `card_cache` | Sem backup — reconstruível pelo job de bulk |
| Redis | Sem backup — volátil por design |
| Estado de partida | Sem backup — em memória (`ADR-006`) |
| Segredos | Cofre do provedor, com cópia offline em local seguro |
| Código | GitHub + espelho |

### 6.1 Cenários de desastre

| Cenário | Impacto | Plano |
|---|---|---|
| Perda de um game node | Salas daquele nó | Aceito; usuários criam nova sala |
| Perda de todos os game nodes | Nenhuma partida possível | Subir nós novos (~10 min com imagem pronta) |
| Perda do Postgres | Sem login e sem decks | *Failover* do gerenciado; se não houver, restauração PITR |
| Perda da região de nuvem | Serviço fora | Aceito no MVP; multi-região é pós-V2 |
| Comprometimento de segredo | Variável | Rotação imediata; invalidação de todas as sessões |
| Conta de provedor suspensa | Serviço fora | Código e dados portáveis por design (containers + Postgres) |

---

## 7. Custos

### 7.1 Estimativa mensal (USD)

| Item | MVP (~50 CCU) | V1 (~500 CCU) | V2 (~5.000 CCU) |
|---|---|---|---|
| Frontend (Vercel) | 0–20 | 20 | 20–150 |
| API Core | 7–25 | 50 | 200 |
| Game Servers (VPS) | 12–24 | 80–150 | 500–900 |
| Postgres | 0–15 | 25 | 100 |
| Redis | 0 | 10 | 50 |
| **LiveKit (voz)** | 0–20 | **100–250** | **800–1.500** |
| Cloudflare | 0 | 0–20 | 20–200 |
| Observabilidade | 0 | 0–30 | 50–150 |
| **Total** | **~US$ 20–100** | **~US$ 300–550** | **~US$ 1.700–3.250** |

### 7.2 Controle de custo

| Alavanca | Quando acionar |
|---|---|
| Reduzir bitrate de voz (32 → 24 kbps) | Fatura de voz crescendo |
| LiveKit *self-hosted* | Fatura de voz > ~US$ 300/mês |
| Aumentar cache de imagem no Service Worker | Banda de CDN alta |
| VPS de provedor mais barato (Hetzner) | Custo de game server dominante |
| Teto de salas simultâneas | Pico inesperado |
| Métrica **custo por partida** no painel de negócio | Sempre visível (`NFR-10`) |

**Regra de degradação:** nunca cortar a partida por custo. Degradar áudio, sim; negar a mesa, não
(`RN04`).

---

## 8. Segurança operacional

| Controle | Detalhe |
|---|---|
| Acesso a produção | 2FA obrigatória; princípio do menor privilégio; acesso humano auditado |
| SSH nas VPS | Só chave pública; senha desabilitada; `fail2ban` |
| Firewall | Apenas 80/443 (e a porta do Colyseus atrás do proxy) |
| Banco | Rede privada; sem IP público |
| Segredos | Cofre do provedor; nunca no repositório |
| Rotação | JWT anual; credenciais de banco a cada 6 meses |
| Patches de SO | Automático para segurança; janela mensal para o resto |
| Auditoria | Log de acesso administrativo retido por 1 ano |

---

## 9. Runbook — situações comuns

| Situação | Diagnóstico | Ação |
|---|---|---|
| **Sala travada** | Verificar `ws_room_tick_duration` do nó | Se o *tick* estourou, reiniciar o nó (perde as salas dele) |
| **Nó com CPU alta** | Conferir salas ativas e `patch_duration` | Marcar como *draining*; subir nó novo |
| **Importação de deck falhando** | `scryfall_requests_total{status="429"}` | Confirmar a fila de 100 ms; considerar servir só do cache |
| **Voz não conecta** | `voice_join_success_rate` + status do LiveKit | Verificar emissão de token; conferir *fallback* TURN |
| **Login falhando** | Logs da API + status do provedor OAuth | Verificar segredo do provedor e `redirect_uri` |
| **Banco lento** | `db_query_duration` + consultas lentas | Verificar índices; procurar N+1 |
| **Pico de 5xx** | Sentry + logs | Rollback se coincidir com deploy recente |
| **Suspeita de abuso** | `ws_intents_rejected_total` por `sessionId` | Bloquear conta; revisar *rate limits* |

> Este runbook é um resumo. O procedimento detalhado de plantão está listado como lacuna no
> `readme.md` §7 (`runbook_de_incidentes.md`).

---

## 10. Checklist de infraestrutura

- [ ] Cloudflare na frente de tudo, com DDoS ativo.
- [ ] TLS 1.3 e HSTS em todos os domínios.
- [ ] Cada game node com endereço público próprio.
- [ ] `@colyseus/redis-presence` e `redis-driver` configurados.
- [ ] `POST /rooms` retornando o `wsUrl` do nó correto.
- [ ] Proxy com `proxy_read_timeout` alto e cabeçalhos de *upgrade*.
- [ ] Drenagem implementada no deploy do game server.
- [ ] Migrações compatíveis para trás, em duas etapas quando destrutivas.
- [ ] `HEALTHCHECK` nas imagens; *health check* no orquestrador.
- [ ] Imagens sem root e com tag por SHA.
- [ ] `/metrics` exposto e coletado pelo Prometheus.
- [ ] Painéis do Grafana criados (§5.2).
- [ ] Alertas configurados com destino real (§5.4).
- [ ] Backup diário + PITR e **teste mensal de restauração**.
- [ ] Segredos em cofre; nenhum no repositório.
- [ ] Métrica de custo por partida no painel.
- [ ] Banco sem IP público.
- [ ] 2FA em todos os acessos administrativos.
