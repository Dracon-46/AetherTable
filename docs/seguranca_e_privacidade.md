# Diretrizes de Segurança, Privacidade e Anti-Cheat

| Campo | Valor |
|---|---|
| **ID** | `DOC-050` |
| **Versão** | 1.1 |
| **Status** | Estável |
| **Última revisão** | 2026-08-20 |
| **Documentos relacionados** | [readme.md](readme.md) · [plano_de_seguranca_e_ameacas_threat_model.md](plano_de_seguranca_e_ameacas_threat_model.md) · [especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md) · [modelo_de_dados.md](modelo_de_dados.md) |

> Este documento define **os controles que aplicamos**. Para o mapeamento de ameaças e vetores de
> ataque, use [plano_de_seguranca_e_ameacas_threat_model.md](plano_de_seguranca_e_ameacas_threat_model.md).

---

## 1. Segurança de infraestrutura

### 1.1 Criptografia em trânsito

| Canal | Exigência |
|---|---|
| HTTP | **HTTPS obrigatório**, TLS 1.3; HSTS com `max-age` de 1 ano e `includeSubDomains` |
| WebSocket | **WSS obrigatório** (TLS 1.3). Nenhum *fallback* para `ws://` em produção |
| WebRTC | SRTP (obrigatório pelo padrão) + DTLS na negociação |
| Banco de dados | TLS na conexão da aplicação ao Postgres |
| Redis | TLS quando gerenciado; rede privada quando não |

### 1.2 Rate limiting

Rotas de login e criação de sala têm limitação rigorosa via Redis, para evitar força bruta e
esgotamento de recursos.

| Escopo | Limite | Chave |
|---|---|---|
| Global HTTP | 100 req/min | IP |
| `POST /auth/login` · `/auth/register` | **5 req/min** | IP |
| `POST /rooms` | **3 req/hora** | usuário |
| `POST /decks/import` | 10 req/min | usuário |
| `GET /cards/search` | 30 req/min | usuário |
| Intenções WebSocket | **30/s** | conexão |
| Rolagem de dados | 5 / 10 s | jogador |
| Chat | 10 mensagens / 10 s | jogador |
| Criação de fichas | ≤ 50 por intenção; teto de 200 por jogador | jogador |

Em camada de borda, o Cloudflare aplica limitação adicional por IP e proteção DDoS — importante porque
WebSocket e WebRTC são alvos atraentes para exaustão de conexão.

### 1.3 Sanitização de entrada

Os usuários importam texto livre para decks e usam chat em tempo real. Toda string precisa passar por
validação e sanitização.

| Camada | Ferramenta | O que faz |
|---|---|---|
| Frontend (exibição) | `DOMPurify` | Sanitiza antes de renderizar mensagem de chat |
| Frontend (React) | Escape automático | React já escapa texto em nós do DOM |
| Backend HTTP | **Zod** | Valida tipo, tamanho e formato de todo *payload* |
| Backend WS | **Zod** | Valida toda intenção (`FR-11`) |
| Banco | Prisma | *Parameterized queries* — nada de SQL concatenado |

**Regras específicas de campo:**

| Campo | Restrição |
|---|---|
| `username` | `^[a-zA-Z0-9_]{3,32}$` |
| `displayName` | ≤ 48 caracteres; sem caracteres de controle nem *zero-width* |
| Nome de deck | ≤ 80 caracteres; letras Unicode, dígitos, espaço, `-`, `'`, `,`, `.` |
| Decklist | ≤ 64 KB e ≤ 1.000 linhas |
| Mensagem de chat | ≤ 500 caracteres; markdown **não** renderizado como HTML |
| Nome de ficha | ≤ 40 caracteres |
| `roomId` | Exatamente 6 caracteres de `A-Z2-9` |

> **Cuidado adicional:** o chat **não** renderiza HTML nem markdown como HTML. Um link aparece como
> texto, não como âncora clicável — remove de uma vez a superfície de *phishing* dentro da mesa.

### 1.4 Autenticação e sessão

| Controle | Implementação |
|---|---|
| Hash de senha | **Argon2id** (memória 64 MB, 3 iterações, paralelismo 4) |
| Senha mínima | 10 caracteres, verificada contra lista de senhas vazadas comuns |
| OAuth | Google e Discord com **PKCE** e `state` aleatório validado |
| *Access token* | JWT, TTL de **15 min**, no header `Authorization` |
| *Refresh token* | **Rotativo**, TTL de 7 dias, cookie `HttpOnly; Secure; SameSite=Strict` |
| Detecção de reuso | Reuso de *refresh* rotacionado **invalida toda a família** de tokens |
| Token de assento (WS) | Uso único, TTL de 60 s, vinculado a `roomId` |
| Token de voz (LiveKit) | Uso único, escopo de `roomId`, sem permissão de vídeo, dados ou gravação |
| Invalidação | Troca de senha ou exclusão de conta invalida **todas** as sessões (`FR-19`) |
| Enumeração de contas | Mensagens de erro genéricas em login e recuperação |

### 1.5 Cabeçalhos de segurança

| Header | Valor |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `microphone=(self)`, `camera=()`, `geolocation=()` |
| `Content-Security-Policy` | `default-src 'self'`; `img-src 'self' https://cards.scryfall.io data:`; `connect-src 'self' wss://*.aethertable.app https://api.scryfall.com https://*.livekit.cloud`; `frame-ancestors 'none'` |

### 1.6 Gestão de segredos

| Regra | Detalhe |
|---|---|
| Nunca no repositório | `.env` no `.gitignore`; `.env.example` sem valores reais |
| Produção | Variáveis de ambiente do provedor ou cofre gerenciado |
| Chave do LiveKit | **Somente no Backend Core**. Nunca chega ao frontend |
| Segredo de JWT | Rotação anual, com janela de aceitação da chave anterior |
| Credenciais de banco | Usuário da aplicação sem permissão de DDL em produção |
| Varredura | *Secret scanning* no CI; PR com segredo é bloqueado |

---

## 2. Prevenção de cheats (design de estado oculto)

Mesmo sendo um jogo casual, a plataforma deve impedir **tecnicamente** que jogadores usem extensões de
navegador ou inspeção de pacotes para ver a mão ou o grimório dos oponentes.

### 2.1 A abordagem ingênua (vulnerável)

O servidor envia a lista de todas as cartas da mesa, incluindo as das mãos dos oponentes, e o frontend
de cada jogador apenas "esconde" a imagem via CSS ou Canvas.

**Por que isso não funciona:** o dado está no cliente. Basta abrir a aba *Network → WS* do DevTools e
ler o *frame*. Não é preciso ferramenta especial nem conhecimento avançado — é um clique e uma leitura.
Qualquer proteção implementada apenas no cliente é decorativa.

### 2.2 A abordagem segura (nossa implementação)

O servidor Colyseus usa o decorador **`@filter`** nas propriedades sensíveis do `Schema`. O campo
`scryfallId` só é **serializado** para o cliente que tem direito de vê-lo.

```ts
@filter(function (this: Card, client: { sessionId: string }) {
  // zona pública → todos veem
  if (!['HAND', 'LIBRARY'].includes(this.zone)) {
    // exceção: carta face para baixo no campo só é conhecida pelo controlador
    if (this.faceDown && this.zone === 'BATTLEFIELD') {
      return client.sessionId === this.controllerId;
    }
    return true;
  }
  // zona oculta → só o dono
  return client.sessionId === this.ownerId;
})
@type('string') scryfallId!: string;
```

**O que cada cliente recebe da mesma carta na mão do Jogador 1:**

```json
// para o Jogador 1 (dono)
{ "id": "uuid-123", "zone": "HAND", "ownerId": "player_1", "scryfallId": "d5a0f3e2-..." }

// para os Jogadores 2, 3 e 4
{ "id": "uuid-123", "zone": "HAND", "ownerId": "player_1" }
```

Para quem tenta trapacear, o pacote de rede referente à mão do oponente é **literalmente vazio de
informação sensível**. Não há o que decodificar.

### 2.3 O que permanece público — e por quê

| Informação | Público? | Motivo |
|---|---|---|
| `hand.length` / `handCount` | ✅ | O jogo exige saber quantas cartas o oponente tem |
| `library.length` | ✅ | Informação legítima de partida |
| Existência do objeto (`id`) | ✅ | Necessária para desenhar o verso na posição correta |
| Battlefield, cemitério, exílio, comando | ✅ | Zonas públicas por definição do jogo |
| Identidade de carta em mão/grimório | ❌ | `RN02` |
| Ordem do grimório | ❌ | Vazaria a sequência de compras |

### 2.4 O grimório é oculto até para o dono

O dono **não** recebe o conteúdo da própria `LIBRARY` no estado. Se recebesse, bastaria abrir o
DevTools do próprio navegador para conhecer a ordem completa das próximas compras — trapaça contra os
outros três.

"Olhar o topo" é uma revelação **explícita e efêmera**, entregue por `revealToOwner` com
`client.send()` para um único cliente, e registrada no log como "Jogador X olhou o topo do grimório".

### 2.5 Vazamento por canal secundário

O `@filter` protege o **estado**. Os canais paralelos exigem disciplina manual:

| Canal | Risco | Controle |
|---|---|---|
| Eventos efêmeros | `broadcast` de revelação | `revealToOwner` **sempre** com `client.send()`, nunca `broadcast` |
| Log de ações | "Jogador A comprou Sol Ring" | Variantes `_HIDDEN` obrigatórias (`RN09`) |
| Mensagens de erro | Nome de carta em `error`/`warning` | Proibido citar carta de zona oculta |
| Requisições de imagem | Buscar a imagem revela a carta ao *proxy* | Nenhuma imagem é requisitada para `LIBRARY` (`FR-23`) |
| Métricas | Cardinalidade por carta | Métricas jamais rotuladas por `scryfallId` |
| Contagem de bytes do patch | Inferência estatística | Risco residual aceito: o `@filter` produz pacotes de tamanho semelhante |

### 2.6 Aleatoriedade verificável

Toda ação de sorte é resolvida no servidor com `crypto.randomInt` (`RN06`, `FR-09`):

- Impede que um cliente modificado "escolha" o resultado do dado.
- Impede previsão de embaralhamento a partir de saídas observadas — `Math.random()` seria vulnerável.
- Publica o resultado no log, para todos, ao mesmo tempo.

### 2.7 Autorização por intenção

O servidor rejeita intenções sobre entidades que o remetente não controla (`FR-12`), com registro de
auditoria. Isso impede o cliente modificado de mover a carta de outro jogador ou comprar do grimório
alheio.

**Exceção deliberada:** ajustar a vida de outro jogador é permitido — reflete a mesa física, onde
qualquer um mexe em qualquer contador. O controle é social, apoiado pelo log que registra o autor.

### 2.8 O que **não** conseguimos impedir

Honestidade sobre os limites:

| Trapaça | Por que é impossível impedir tecnicamente |
|---|---|
| Combinar por fora (Discord paralelo) | Fora do sistema |
| Compartilhar tela com um aliado | Fora do sistema |
| Errar regras de propósito | Não há motor de regras (`RN01`) |
| Ignorar o custo de mana | Idem |
| Sair da partida ao perder | Comportamento social |

Mitigação disponível: log completo de ações, e as ferramentas de bloqueio e report (`RF03`). O sistema
garante **informação oculta** e **aleatoriedade justa** — o resto é contrato social, exatamente como na
mesa física.

---

## 3. Privacidade e conformidade

### 3.1 Coleta mínima

O sistema armazena apenas o necessário para funcionar:

| Dado | Coletado? | Origem |
|---|---|---|
| E-mail | ✅ | Cadastro ou provedor OAuth |
| Nome de usuário / exibição | ✅ | Escolha do usuário |
| Foto de perfil (URL) | ✅ | Provedor OAuth |
| Hash de senha | Só em conta local | Argon2id |
| Decks | ✅ | Criação do usuário |
| Preferências | ✅ | Configuração |
| IP | Temporário (log de acesso, 6 meses) | Requisição |
| **Senha do provedor OAuth** | ❌ **Nunca** | — |
| **Token do provedor OAuth** | ❌ **Nunca armazenado** | Usado e descartado |
| **Dados de pagamento** | ❌ Nunca — a doação ocorre no Patreon | — |
| **Conteúdo de chat** | ❌ **Não persistido** | — |
| **Áudio de voz** | ❌ **Nunca gravado** | — |
| **Estado ou histórico de jogadas** | ❌ (`RN12`) | — |

### 3.2 Direitos do titular (LGPD)

| Direito | Como é atendido |
|---|---|
| Acesso | `GET /users/me` retorna todos os dados do titular |
| Portabilidade | Exportação de decks em `.txt`/JSON (`DOC-030` §3.9) |
| Correção | `PATCH /users/me` |
| **Eliminação** | `DELETE /users/me` — *soft delete* imediato, expurgo físico em 30 dias (`RF13`) |
| Informação sobre compartilhamento | Esta seção e a política pública de privacidade |
| Revogação de consentimento | Desvincular provedor OAuth ou excluir a conta |

### 3.3 Compartilhamento com terceiros

| Terceiro | O que recebe | O que **não** recebe |
|---|---|---|
| **Scryfall** | Nomes de carta consultados e IDs | Nenhum dado pessoal; nenhuma identificação de usuário |
| **Google / Discord** | Requisição de autenticação | Nada sobre decks ou partidas |
| **LiveKit** | Trilha de áudio efêmera, `identity`, `roomId` | Nada é gravado ou retido |
| **Cloudflare** | Tráfego HTTP (como proxy) | — |
| **Vercel / Render** | Hospedagem | — |
| Anunciantes | **Nada** — não há publicidade | — |
| *Data brokers* | **Nada, jamais** | — |

### 3.4 Áudio: garantia explícita

O LiveKit oferece gravação de sessão. O recurso é **desabilitado** e os tokens emitidos **não** carregam
permissão de gravação. Nenhuma trilha é armazenada, transcrita ou analisada. O navegador sempre exige
permissão explícita de microfone, e a UI mostra permanentemente se o microfone está aberto — não existe
escuta oculta.

### 3.5 Retenção

| Dado | Retenção |
|---|---|
| Conta e decks | Enquanto a conta existir |
| Conta excluída | Expurgo físico em 30 dias |
| `card_cache` | Indefinida (dado público, não pessoal) |
| `MatchSummary` | 12 meses (agregado, sem dado pessoal) |
| `Report` de moderação | 24 meses após resolução |
| Log de acesso com IP | 6 meses |
| Chat | **Não persistido** |
| Áudio | **Nunca gravado** |

---

## 4. Conformidade legal — WotC Fan Content Policy

Para blindagem jurídica, deve haver **disclaimer claro no rodapé de todas as páginas**:

> AetherTable is unofficial Fan Content permitted under the Fan Content Policy. Not
> approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast.
> ©Wizards of the Coast LLC.

### 4.1 Regras operacionais

| Regra | Detalhe |
|---|---|
| Gratuidade total do jogo | Cartas, salas, zonas, contadores e voz são **sempre** gratuitos (`RN04`) |
| Sem venda de conteúdo do IP | Nenhum *single* virtual, *booster* ou *loot box* |
| Sem competitivo premiado | Nenhum torneio ranqueado com premiação envolvendo o IP |
| Imagens | Servidas da CDN da Scryfall; não hospedamos artes |
| Marca | Nome e identidade visual não podem sugerir endosso oficial |
| Atribuição à Scryfall | "Dados de cartas fornecidos pela Scryfall" no rodapé do Deckbuilder |
| Monetização | Somente doação e cosméticos de plataforma (`DOC-001` §6) |
| Revisão | **Toda** feature de monetização passa por revisão contra esta política antes de entrar no backlog |

---

## 5. Segurança no ciclo de desenvolvimento

| Controle | Quando | Bloqueia o *merge*? |
|---|---|---|
| `npm audit` / scan de dependências | Cada PR | Sim, para vulnerabilidade alta ou crítica |
| *Secret scanning* | Cada PR | **Sim** |
| Lint proibindo `Math.random` em `game-server/` | Cada PR | Sim |
| **Auditoria de pacote WS** (`G1`) | Cada PR que toca o `Schema` | **Sim** |
| Revisão obrigatória de campo novo em `Card` | Cada PR | Sim |
| *Fuzzing* de intenções WS | Noturno | Não, mas abre issue |
| Verificação de headers de segurança | Deploy | Sim |
| Teste de `@filter` com espectador | Release | Sim |

### 5.1 Regra de ouro para revisão de código

> Ao revisar um PR que adiciona ou altera qualquer campo do `Schema`, a pergunta obrigatória é:
> **"isto revela algo sobre uma carta que deveria estar oculta?"**
> Se a resposta for "sim" ou "talvez", o campo entra com `@filter` — ou o PR não passa.

---

## 6. Resposta a incidentes

| Severidade | Exemplo | Prazo de reação | Ação |
|---|---|---|---|
| **P0 — Crítico** | Vazamento de informação oculta; exposição de dados pessoais | Imediato | Desligar o recurso afetado; corrigir; comunicar publicamente |
| **P1 — Alto** | RCE, escalonamento de privilégio, bypass de autenticação | < 4 h | Patch de emergência |
| **P2 — Médio** | XSS armazenado, bypass de *rate limit* | < 48 h | Correção no próximo deploy |
| **P3 — Baixo** | Falha de configuração sem exploração prática | < 2 semanas | Backlog priorizado |

**Contato de segurança.** Canal público (`security@…`) para relatos responsáveis, com compromisso de
resposta em 72 h e sem retaliação a quem reporta de boa-fé.

**Comunicação.** Incidente que afete dados pessoais é comunicado aos titulares e à ANPD conforme a
LGPD. Vazamento de informação oculta é comunicado à comunidade — é o pilar de confiança do produto e
esconder seria pior do que o incidente.
