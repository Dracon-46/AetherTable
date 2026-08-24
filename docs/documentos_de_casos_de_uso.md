# Documento de Casos de Uso (Narrativas)

| Campo | Valor |
|---|---|
| **ID** | `DOC-012` |
| **Versão** | 1.1 |
| **Status** | Estável |
| **Última revisão** | 2026-08-20 |
| **Documentos relacionados** | [readme.md](readme.md) · [regras_de_negocio_e_casos_de_uso.md](regras_de_negocio_e_casos_de_uso.md) · [documento_de_funcionalidades.md](documento_de_funcionalidades.md) · [guia_de_ui_e_design_system.md](guia_de_ui_e_design_system.md) |

---

## 1. Como usar este documento

Aqui os casos de uso são narrados **na perspectiva do usuário**: o que ele vê, clica e espera.
Servem de base para escrever testes E2E (`DOC-052`) e para validar a UI (`DOC-041`).

Para a mesma jornada descrita em termos de rede e mutação de estado, use
[regras_de_negocio_e_casos_de_uso.md](regras_de_negocio_e_casos_de_uso.md) §4.

### 1.1 Atores

| Ator | Descrição |
|---|---|
| **Jogador** | Usuário autenticado. Papel padrão. |
| **Host** | Jogador que criou a sala. Sem privilégios especiais de jogo, apenas de configuração. |
| **Convidado** | Jogador que entra por link ou código. |
| **Espectador** | Usuário com acesso somente leitura às zonas públicas (V2). |
| **Sistema** | O conjunto backend + game server, quando age sozinho. |
| **Scryfall** | API externa de dados de carta. |

---

## CDU01 — Importar e salvar deck

| Campo | Valor |
|---|---|
| **Ator primário** | Jogador |
| **Pré-condições** | Estar autenticado |
| **Pós-condições** | Deck persistido e disponível para seleção em sala |
| **Funcionalidades** | `F02`, `F03`, `F05` |

**Fluxo principal**

1. O ator acessa "Meus Decks" e clica em **Novo Deck**.
2. O ator escolhe **Importar via Texto**.
3. O ator cola a lista (ex.: `1x Black Lotus`) e clica em **Importar**.
4. O sistema consulta a Scryfall e converte o texto em cartas visuais, exibindo uma barra de progresso.
5. O sistema exibe o Deckbuilder com as cartas resolvidas e um painel de avisos.
6. O ator digita o nome do deck, marca o comandante e clica em **Salvar**.
7. O sistema persiste e confirma com *toast* de sucesso.

**Fluxos alternativos**

- **A1 — Carta não encontrada:** no passo 4, se o nome estiver incorreto, o sistema **não descarta a
  importação**. Ele lista as linhas problemáticas em vermelho no topo do Deckbuilder, com o texto
  original editável e sugestões de nome parecido (via `/cards/autocomplete`). O ator corrige e clica
  em **Resolver novamente**.
- **A2 — Deck fora do padrão:** contagem ≠ 100, carta banida ou duplicata não-básica geram *badge*
  de aviso. O ator pode salvar de qualquer forma (`RN05`).
- **A3 — Construção manual:** em vez de importar, o ator usa a busca (`F01`) e adiciona carta por carta.
- **A4 — Duplicar deck existente:** o ator abre um deck, clica em **Duplicar** e edita a cópia.

**Fluxos de exceção**

- **E1 — Scryfall indisponível:** mensagem "não foi possível consultar a base de cartas agora"; o
  texto colado é preservado no campo para nova tentativa.
- **E2 — Sessão expirada:** o ator é levado ao login e retorna ao Deckbuilder com o texto preservado
  em armazenamento local.

**Critério de aceite E2E:** colar uma decklist de 100 linhas do Moxfield e ter o deck salvo e jogável
em menos de 60 segundos, sem edição manual.

---

## CDU02 — Criar e configurar sala de jogo

| Campo | Valor |
|---|---|
| **Ator primário** | Jogador (Host) |
| **Pré-condições** | Ter pelo menos um deck salvo |
| **Pós-condições** | Sala ativa com o host na mesa e link de convite disponível |
| **Funcionalidades** | `F14`, `F06`, `F16` |

**Fluxo principal**

1. O ator clica em **Criar Partida** no painel principal.
2. O sistema solicita nome da sala, senha (opcional), deck a utilizar e se a voz inicia ativada.
3. O ator preenche e confirma.
4. O sistema aloca a sala, leva o ator ao tabuleiro e exibe o link de convite com botão **Copiar**.
5. O sistema embaralha o grimório do ator e serve a mão inicial de 7 cartas.
6. O sistema habilita a conexão de áudio, pedindo permissão de microfone.

**Fluxos alternativos**

- **A1 — Sem deck salvo:** o sistema redireciona ao Deckbuilder com a mensagem "crie um deck para jogar".
- **A2 — Permissão de microfone negada:** a partida segue; o ator entra como ouvinte e pode habilitar depois.
- **A3 — Sala sem senha:** o link entra direto, sem etapa adicional.

**Fluxos de exceção**

- **E1 — Sem capacidade de servidor:** "todos os servidores estão cheios, tente em instantes".
- **E2 — Limite de criação atingido:** após 3 salas na hora, o sistema informa o limite e o tempo de espera.

---

## CDU03 — Ingressar em uma partida existente

| Campo | Valor |
|---|---|
| **Ator primário** | Jogador (Convidado) |
| **Pré-condições** | Ter o link ou código da sala |
| **Pós-condições** | Cartas do convidado injetadas na mesa; demais jogadores notificados |
| **Funcionalidades** | `F14`, `F06` |

**Fluxo principal**

1. O ator acessa o link recebido.
2. O sistema verifica a disponibilidade da sala e pede a seleção de um deck.
3. O ator escolhe o deck e clica em **Entrar na Mesa**.
4. O sistema injeta os objetos de carta na zona correspondente e conecta o ator ao WebSocket.
5. Os demais jogadores recebem a notificação de entrada no log.
6. O painel do novo jogador aparece na mesa dos outros, com vida 40.

**Fluxos alternativos**

- **A1 — Sala com senha:** o sistema pede a senha antes do passo 2; 3 tentativas erradas aplicam
  espera de 30 s.
- **A2 — Entrada por código:** o ator digita o código de 6 caracteres na tela inicial.
- **A3 — Retorno à sala em que já estava:** o sistema reconhece o `sessionId` e reconecta em vez de
  criar um novo assento (ver `CDU08`).

**Fluxos de exceção**

- **E1 — Sala cheia (4 jogadores):** "esta mesa está cheia"; o ator pode entrar como espectador se o
  host habilitou (V2).
- **E2 — Sala inexistente ou encerrada:** "esta mesa não existe mais" com botão para o Dashboard.
- **E3 — Ator bloqueado pelo host:** ingresso negado sem revelar o motivo específico.

---

## CDU04 — Ação básica de turno (comprar e jogar carta)

| Campo | Valor |
|---|---|
| **Ator primário** | Jogador na mesa |
| **Pré-condições** | Estar conectado em sala ativa |
| **Pós-condições** | Carta no Battlefield, visível a todos; log registrado |
| **Funcionalidades** | `F09`, `F07`, `F15` |

**Fluxo principal**

1. O ator clica em **Comprar Carta** ou pressiona `D` com o cursor sobre o grimório.
2. O sistema move a carta do topo do grimório para a mão do ator. Ela fica visível **apenas para ele**.
3. O ator clica na carta da mão, segura e arrasta até o Battlefield.
4. Ao soltar, o cliente envia o evento ao servidor.
5. O servidor atualiza a zona e repassa as coordenadas a todos.
6. O log registra: **"Jogador X jogou Sol Ring"**.
7. O sistema revela a imagem da carta para todos os demais.

**Fluxos alternativos**

- **A1 — Comprar múltiplas:** o ator usa **Comprar X** e informa a quantidade.
- **A2 — Jogar via teclado:** com a carta selecionada na mão, `B` a envia ao Battlefield em posição livre.
- **A3 — Jogar face para baixo:** o ator mantém `F` ao soltar; a carta entra virada e o log diz apenas
  "Jogador X jogou uma carta face para baixo".
- **A4 — Mandar direto para outra zona:** arrastar da mão para o cemitério (descartar) ou exílio.

**Fluxos de exceção**

- **E1 — Grimório vazio:** log "Jogador X tentou comprar de um grimório vazio". O sistema **não**
  elimina o jogador — isso seria aplicar regra (`RN01`).
- **E2 — Dois jogadores tentam mover a mesma carta:** o primeiro a pegar mantém o controle; o segundo
  vê a carta se mover normalmente (`FR-10`).
- **E3 — Conexão cai no meio do arraste:** a carta permanece na última posição sincronizada.

---

## CDU05 — Rolar dado e interagir com marcadores

| Campo | Valor |
|---|---|
| **Ator primário** | Jogador na mesa |
| **Pré-condições** | Estar em sala ativa |
| **Funcionalidades** | `F12`, `F08`, `F26` |

**Fluxo principal — dado**

1. O ator clica no ícone de **Dados** e escolhe **Rolar D20**.
2. O sistema gera o número no servidor (1–20).
3. O resultado aparece com animação para todos e é registrado no log:
   "Jogador X rolou D20 e tirou 15".

**Fluxo principal — marcador**

1. O ator clica com o botão direito sobre uma carta que controla e escolhe **+1 marcador +1/+1**.
2. O sistema atualiza o estado e envia o *patch*.
3. A carta passa a exibir o *badge* "1" para todos na sala.

**Fluxos alternativos**

- **A1 — Atalho de teclado:** com a carta selecionada, `+` e `-` ajustam o marcador padrão.
- **A2 — Marcador em lote:** com várias cartas selecionadas, o ajuste vale para todas.
- **A3 — Tipo de marcador:** o menu permite `+1/+1`, `-1/-1`, *charge*, *loyalty* e genérico, cada um
  com cor própria.
- **A4 — Moeda:** o menu de dados também oferece cara ou coroa.

**Fluxos de exceção**

- **E1 — Marcador negativo abaixo de zero:** o total é fixado em 0.
- **E2 — Spam de rolagens:** após 5 rolagens em 10 s, o sistema pede para aguardar.

---

## CDU06 — Gerenciar vida e dano de comandante

| Campo | Valor |
|---|---|
| **Ator primário** | Jogador na mesa |
| **Funcionalidades** | `F11`, `F23` |

**Fluxo principal**

1. O painel de status mostra a vida do ator (inicia em 40) e a de cada oponente.
2. O ator clica em `−` para reduzir, `+` para aumentar, ou arrasta verticalmente para variação rápida.
3. Para dano de comandante, o ator abre a matriz e incrementa a célula do oponente correspondente.
4. Cada alteração propaga a todos e gera log: "Jogador X: vida 40 → 37".

**Fluxos alternativos**

- **A1 — Digitar valor:** clique no número abre campo de edição direta.
- **A2 — Outros contadores:** aba do painel expõe veneno, energia, experiência, monarca e iniciativa.
- **A3 — Corrigir erro:** basta ajustar de volta; o sistema não trava histórico (`RN01`).

**Fluxos de exceção**

- **E1 — Vida chega a 0:** o sistema **não** elimina ninguém. Exibe indicador visual e registra no
  log; a decisão é dos jogadores.

---

## CDU07 — Usar o chat de voz

| Campo | Valor |
|---|---|
| **Ator primário** | Jogador na mesa |
| **Funcionalidades** | `F16` |

**Fluxo principal**

1. Ao entrar na sala, o navegador pede permissão de microfone e o ator concede.
2. O ator fala; o painel de todos exibe a aura dourada em torno do seu avatar.
3. O ator clica no ícone de microfone para se silenciar e clica de novo para voltar.
4. O ator clica no avatar de um oponente para aplicar *mute* local ou ajustar o volume dele.

**Fluxos alternativos**

- **A1 — Push-to-Talk:** nas configurações, o ator troca de VAD para PTT e define a tecla.
- **A2 — Escolher dispositivo:** o painel de áudio lista microfones e saídas disponíveis.

**Fluxos de exceção**

- **E1 — Permissão negada:** o ator entra como ouvinte; a UI mostra como habilitar depois.
- **E2 — Rede sem UDP:** o sistema cai para TURN/TCP; a UI indica "qualidade de áudio reduzida".
- **E3 — Voz cai:** a mesa continua funcionando; a UI mostra "voz reconectando…".

---

## CDU08 — Recuperar-se de uma queda de conexão

| Campo | Valor |
|---|---|
| **Ator primário** | Jogador na mesa |
| **Funcionalidades** | `F32` |

**Fluxo principal**

1. A conexão do ator cai (Wi-Fi, aba fechada, guia recarregada).
2. O cliente exibe *overlay* "reconectando…" com contagem regressiva de 90 s.
3. Para os demais, o painel do ator fica esmaecido com "reconectando…"; as cartas dele **não se movem**.
4. A conexão volta; o cliente recebe o estado completo e redesenha a mesa.
5. O ator retoma exatamente de onde parou.

**Fluxos de exceção**

- **E1 — Janela de 90 s expira:** o ator é removido, suas cartas saem da mesa e o log registra a saída.
  Ao voltar, ele pode entrar como novo jogador se houver vaga.
- **E2 — Servidor reiniciado:** a sala é perdida; a UI informa e oferece criar nova sala.

---

## CDU09 — Criar tokens e cópias

| Campo | Valor |
|---|---|
| **Ator primário** | Jogador na mesa |
| **Funcionalidades** | `F10`, `F24` |

**Fluxo principal**

1. O ator abre o painel **Tokens**.
2. O sistema sugere fichas relacionadas ao deck (busca `t:token` na Scryfall) e oferece busca livre.
3. O ator escolhe a ficha e a quantidade, e clica em **Criar**.
4. As fichas aparecem no Battlefield do ator e no de todos os demais.

**Fluxos alternativos**

- **A1 — Ficha em branco:** o ator define nome, poder/resistência e cor, sem imagem.
- **A2 — Copiar carta existente:** botão direito sobre a carta → **Criar cópia**.
- **A3 — Remover fichas:** arrastar para o cemitério, ou **Limpar todas as fichas**.

---

## CDU10 — Espectar uma partida *(V2)*

| Campo | Valor |
|---|---|
| **Ator primário** | Espectador |
| **Funcionalidades** | `F38` |

**Fluxo principal**

1. O ator acessa um link de espectador de uma sala que permite espectadores.
2. O sistema conecta o ator em modo somente leitura.
3. O ator vê Battlefield, Graveyard, Exile, Command Zone, contadores e log de todos.
4. O ator **não** vê a mão nem o grimório de ninguém e não pode interagir com objetos.

**Fluxos de exceção**

- **E1 — Espectadores desabilitados:** ingresso negado com mensagem clara.
- **E2 — Limite de espectadores atingido:** "esta mesa já tem o número máximo de espectadores".

---

## 2. Cobertura de testes E2E

| CDU | Prioridade de automação | Ferramenta |
|---|---|---|
| CDU01 (import) | **Alta** — caminho crítico | Playwright |
| CDU02 (criar sala) | **Alta** | Playwright |
| CDU03 (entrar) | **Alta** — 2 navegadores | Playwright multi-contexto |
| CDU04 (comprar/jogar) | **Alta** — valida `RN02` na prática | Playwright + inspeção de WS |
| CDU05 (dado/marcador) | Média | Playwright |
| CDU06 (vida) | Média | Playwright |
| CDU07 (voz) | Baixa — manual | Checklist manual |
| CDU08 (reconexão) | **Alta** | Playwright com corte de rede |
| CDU09 (tokens) | Baixa | Playwright |
| CDU10 (espectador) | Média (V2) | Playwright |
