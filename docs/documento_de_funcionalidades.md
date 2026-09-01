# Documento de Requisitos e Funcionalidades

| Campo                       | Valor                                                                                                                                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-003`                                                                                                                                                                                                                                                                                 |
| **Versão**                  | 1.1                                                                                                                                                                                                                                                                                       |
| **Status**                  | Estável                                                                                                                                                                                                                                                                                   |
| **Última revisão**          | 2026-08-20                                                                                                                                                                                                                                                                                |
| **Documentos relacionados** | [readme.md](readme.md) · [documento_de_requisitos_do_produto_prd.md](documento_de_requisitos_do_produto_prd.md) · [documentos_de_casos_de_uso.md](documentos_de_casos_de_uso.md) · [especificacao_do_motor_de_estado_state_machine.md](especificacao_do_motor_de_estado_state_machine.md) |

---

## 1. Visão geral

Este documento é o **catálogo executável de escopo**: cada linha `Fnn` é uma unidade de trabalho
que pode virar item de backlog, ter estimativa e ser testada isoladamente.

O sistema atua como _sandbox_ (mesa virtual) **sem aplicação de regras do jogo**. Os jogadores
seguem as regras por conta própria, como no jogo físico. Nenhuma funcionalidade abaixo valida
legalidade de jogada.

### 1.1 Como ler a tabela

| Coluna   | Significado                                                                               |
| -------- | ----------------------------------------------------------------------------------------- |
| **ID**   | Identificador estável. Nunca reciclar um número.                                          |
| **Prio** | MoSCoW: **M**ust / **S**hould / **C**ould / **W**on't                                     |
| **Fase** | MVP · V1 · V2                                                                             |
| **RF**   | Requisito de produto de origem em `DOC-002`                                               |
| **Lado** | Onde a lógica mora: `FE` frontend · `API` backend core · `GS` game server · `EXT` externo |

---

## 2. Módulo Deckbuilder e biblioteca

| ID      | Funcionalidade                  | Detalhe                                                                                                                                                                                 | Prio  | Fase | RF         | Lado      |
| ------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---- | ---------- | --------- |
| **F01** | Busca integrada de cartas       | Consulta a Scryfall com filtros de nome, tipo, cor, custo de mana e texto de regras. Paginação de 60 resultados com _scroll_ infinito. Debounce de 300 ms no campo.                     | S     | MVP  | RF16       | API + EXT |
| **F02** | Importação por texto            | Cola listas em formato padrão (`1x Sol Ring`, `1 Sol Ring (C21) 263`). Compatível com Moxfield, Archidekt e TappedOut. Suporta seções `Commander`/`Sideboard` e marcador `#!Commander`. | **M** | MVP  | RF04, RF05 | API       |
| **F03** | Gestão de decks                 | Criar, editar, renomear, duplicar, excluir e favoritar. Duplicar gera cópia independente. Exclusão pede confirmação.                                                                    | **M** | MVP  | RF15       | API       |
| **F04** | Seleção de impressões           | Escolher edição, arte e idioma específicos, incluindo Secret Lairs e promos, a partir de `unique=prints` da Scryfall. Prévia lado a lado.                                               | S     | V1   | RF14       | FE + EXT  |
| **F05** | Validação não bloqueante        | Alerta — sem impedir salvamento — quando o deck tem ≠ 100 cartas, carta banida no Commander, mais de uma cópia de carta não-básica, ou comandante ausente/ inválido.                    | **M** | MVP  | RF06       | API       |
| **F17** | Verificação de _color identity_ | Sinaliza cartas fora da identidade de cor do comandante. **Aviso apenas** — coerente com `RN01`.                                                                                        | C     | V1   | RF06       | API       |
| **F18** | Estatísticas do deck            | Curva de mana, distribuição de tipos, contagem de terrenos, _color pips_. Calculado no cliente a partir do cache.                                                                       | C     | V1   | —          | FE        |
| **F19** | Exportação de decklist          | Copiar para a área de transferência ou baixar `.txt` no formato `1x Nome (SET) CN`.                                                                                                     | C     | V1   | —          | FE        |
| **F20** | Deck público por link           | Alternar `is_public` e compartilhar URL somente leitura.                                                                                                                                | C     | V2   | —          | API       |

---

## 3. Módulo da mesa virtual (Game Board)

### 3.1 Zonas

| ID      | Funcionalidade                      | Detalhe                                                                                                                                                                                                               | Prio  | Fase | RF         | Lado |
| ------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---- | ---------- | ---- |
| **F06** | Zonas de jogo pessoais              | `BATTLEFIELD` (público, coordenadas livres), `HAND` (oculto), `LIBRARY` (oculto e ordenado), `GRAVEYARD` (público, lista), `EXILE` (público, lista), `COMMAND` (público, ancorado). Visibilidade imposta no servidor. | **M** | MVP  | RF07, RF09 | GS   |
| **F21** | Contadores de zona                  | Todos veem `library.length` e `hand.length` dos oponentes — números, nunca identidades.                                                                                                                               | **M** | MVP  | RF09       | GS   |
| **F22** | Inspetor de zona pública            | Abrir Graveyard/Exile em grade expansível, com busca por nome e ordenação.                                                                                                                                            | S     | V1   | —          | FE   |
| **F23** | Zona de comando com _commander tax_ | Contador de +2 cumulativo por conjuração, ajustável manualmente.                                                                                                                                                      | S     | V1   | RF19       | GS   |

### 3.2 Manipulação de cartas

| ID      | Funcionalidade     | Detalhe                                                                                                                                                                                    | Prio  | Fase   | RF         | Lado     |
| ------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------ | ---------- | -------- |
| **F07** | Arrastar e soltar  | Movimentação livre no Battlefield com coordenadas contínuas. _Lock_ de arraste no servidor evita disputa entre dois jogadores pela mesma carta. Interpolação suave no cliente do oponente. | **M** | MVP    | RF08, RF17 | FE + GS  |
| **F08** | Ações de carta     | Virar/desvirar (`T`), rotacionar 180° (`Ctrl+T`), adicionar/remover marcadores (`+`/`-`), virar face para baixo (`F`), trazer para frente (Z-index).                                       | **M** | MVP/V1 | RF17       | FE + GS  |
| **F09** | Ações de grimório  | "Comprar 1" (`D`), "Comprar X", "Embaralhar" (`S`), "Olhar o topo N", "Mover para o fundo", "_Mill_ X para o cemitério", "Exilar X do topo". Embaralhar e comprar resolvem no servidor.    | **M** | MVP    | RF18       | GS       |
| **F10** | Geração de tokens  | Buscar fichas oficiais relacionadas ao deck (`t:token`) ou criar ficha em branco com P/T e nome editáveis. Token é objeto independente e desaparece ao sair do Battlefield (opcional).     | S     | V1     | RF20       | FE + EXT |
| **F24** | Cópias de carta    | Duplicar uma carta do Battlefield como objeto novo marcado como cópia.                                                                                                                     | C     | V1     | RF20       | GS       |
| **F25** | Seleção múltipla   | Caixa de arraste ou `Shift+clique` para selecionar várias cartas e mover, desvirar ou mandar de zona em lote. Uma única intenção de rede por lote.                                         | S     | V1     | RF17       | FE + GS  |
| **F26** | Marcadores tipados | `+1/+1`, `-1/-1`, _charge_, _loyalty_, genérico. Cada tipo tem cor própria no _badge_.                                                                                                     | S     | V1     | RF17       | GS       |
| **F27** | Anexar / empilhar  | Encostar uma carta em outra para representar equipamento, aura ou pilha visual, mantendo o grupo ao mover.                                                                                 | C     | V2     | —          | FE + GS  |
| **F28** | Zoom de carta      | `hover` longo ou `Alt+clique` abre a arte em alta resolução em painel lateral.                                                                                                             | **M** | MVP    | —          | FE       |

---

## 4. Módulo de gestão de partida

| ID      | Funcionalidade                           | Detalhe                                                                                                                                                                                   | Prio  | Fase   | RF   | Lado    |
| ------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ | ---- | ------- |
| **F11** | Controle de vida e marcadores de jogador | Vida total (inicia em 40), dano de comandante rastreado por oponente em matriz 4×4, veneno, energia, experiência, monarca e iniciativa. Ajuste por clique, arraste vertical ou digitação. | **M** | MVP/V1 | RF19 | GS      |
| **F12** | Dados e moedas                           | D4, D6, D20 e moeda. RNG **exclusivamente no servidor** (`crypto.randomInt`). Resultado animado para todos e registrado no log.                                                           | **M** | V1     | RF23 | GS      |
| **F13** | Ping / sinalização                       | Segurar tecla e clicar na mesa desenha um radar pulsante visível a todos, com decaimento de ~2 s.                                                                                         | C     | V1     | RF22 | FE + GS |
| **F29** | Indicador de turno                       | Marcador **puramente visual** de turno e fase, avançado manualmente. Não impõe nada.                                                                                                      | S     | V1     | —    | GS      |
| **F30** | _Untap_ em massa                         | Um comando desvira todas as cartas próprias no Battlefield.                                                                                                                               | **M** | MVP    | RF17 | GS      |
| **F31** | Reinício de partida                      | Devolver todas as cartas ao grimório, embaralhar e zerar contadores, mantendo a sala e os jogadores.                                                                                      | S     | V1     | —    | GS      |
| **F32** | Reconexão com estado preservado          | Queda de conexão congela as interações do jogador; retorno com `sessionId` válido dentro de 90 s restaura tudo.                                                                           | **M** | V1     | RF21 | GS      |
| **F33** | Saída e substituição                     | Jogador que sai libera a vaga; suas cartas permanecem no lugar por 90 s antes de serem removidas.                                                                                         | S     | V1     | —    | GS      |

---

## 5. Módulo social e multiplayer

| ID      | Funcionalidade            | Detalhe                                                                                                                                                                                      | Prio  | Fase | RF         | Lado     |
| ------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---- | ---------- | -------- |
| **F14** | Salas instanciadas        | Código aleatório de 6 caracteres, senha opcional e link direto de convite. Limite de jogadores vindo do preset de formato, 1–8 (`RN03`).                                                     | **M** | MVP  | RF07, RF24 | API + GS |
| **F15** | Log de ações + chat       | Painel lateral que mescla mensagens de usuário e logs neutros de sistema ("Jogador A comprou 1 carta"). Logs **nunca** revelam identidade de carta oculta. Filtro por tipo e rolagem retida. | **M** | MVP  | RF10       | GS       |
| **F16** | Chat de voz               | Voz embutida via LiveKit com indicador de "falando agora", mute do próprio microfone, mute local por jogador e volume individual. Modos VAD e Push-to-Talk.                                  | **M** | V1   | RF11       | FE + EXT |
| **F34** | Autenticação social       | Login com Google e Discord via OAuth 2.0, além de e-mail/senha.                                                                                                                              | **M** | MVP  | RF01       | API      |
| **F35** | Perfil e estatísticas     | Avatar, nome de exibição, contagem de partidas e salas criadas.                                                                                                                              | S     | MVP  | RF02       | API      |
| **F36** | Bloqueio e report         | Bloquear impede ingresso em salas do bloqueador; report gera registro para moderação.                                                                                                        | S     | V1   | RF03       | API      |
| **F37** | Lobby público             | Lista de salas abertas com vagas, filtro e entrada rápida.                                                                                                                                   | C     | V2   | RF26       | API      |
| **F38** | Modo espectador           | Acesso somente leitura às zonas públicas. Nunca recebe pacote de zona oculta de ninguém.                                                                                                     | C     | V2   | RF27       | GS       |
| **F39** | Preferências persistentes | Atalhos remapeáveis, volume por jogador, tema e playmat salvos na conta.                                                                                                                     | C     | V1   | RF12       | API + FE |
| **F40** | Cosméticos de apoiador    | Playmat customizado por upload, borda de perfil, título no chat. Nunca afeta estado de jogo.                                                                                                 | C     | V2   | —          | API + FE |

---

## 6. Matriz de cobertura por fase

| Fase    | Funcionalidades                                                                                                          | Total |
| ------- | ------------------------------------------------------------------------------------------------------------------------ | ----- |
| **MVP** | F02, F03, F05, F06, F07, F08 (parcial), F09, F11 (parcial), F14, F15, F21, F28, F30, F34, F35, F01                       | 16    |
| **V1**  | F04, F08 (completo), F10, F11 (completo), F12, F13, F16, F17, F18, F19, F22, F23, F25, F26, F31, F32, F33, F36, F39, F24 | 20    |
| **V2**  | F20, F27, F37, F38, F40                                                                                                  | 5     |

---

## 7. Dependências entre funcionalidades

```
F34 (auth) ──► F03 (gestão de decks) ──► F02 (import) ──► F05 (validação)
                        │                     │
                        │                     └──► F01 (busca)  ──► F04 (printings)
                        ▼
                  F14 (salas) ──► F06 (zonas) ──► F07 (drag) ──► F08 (ações)
                        │              │                            │
                        │              ├──► F21 (contadores)        └──► F25 (seleção múltipla)
                        │              └──► F09 (grimório) ──► F12 (dados: mesmo RNG de servidor)
                        │
                        ├──► F15 (log) ──► F13 (ping)
                        ├──► F16 (voz)
                        ├──► F11 (vida) ──► F23 (commander tax)
                        └──► F32 (reconexão) ──► F33 (saída/substituição)

F10 (tokens) depende de F01 (busca) e F07 (drag)
F38 (espectador) depende de F06 com filtro de visibilidade endurecido
```

**Leitura prática:** `F34 → F03 → F02` é o caminho crítico da Fase 1. `F14 → F06 → F07` é o caminho
crítico da mesa. Nada de `F11`/`F12`/`F13` faz sentido antes de `F14` estar estável.

---

## 8. Critérios de aceite transversais

Aplicam-se a **toda** funcionalidade que toque a mesa:

1. **Servidor é autoritativo.** Nenhuma funcionalidade altera estado só no cliente. O cliente envia
   intenção; o servidor decide e propaga. Ver `DOC-033`.
2. **Zona oculta não vaza.** Qualquer funcionalidade nova que leia carta precisa ser auditada contra
   `RN02`. Se ela puder revelar mão ou grimório alheio, não entra.
3. **Aleatoriedade é do servidor.** Embaralhar, dados, moeda, "olhar o topo" — tudo em `crypto.randomInt` (`RN06`).
4. **Log neutro.** Mensagem automática nunca cita nome de carta que estava oculta.
5. **Sem julgamento de regra.** A funcionalidade pode avisar, nunca bloquear (`RN01`).
6. **Orçamento de performance.** Nenhuma funcionalidade pode derrubar o Canvas abaixo de 30 FPS com
   300 cartas (`NFR-01`).
7. **Reflete em ≤ 150 ms.** p95 do RTT de mutação (`NFR-02`).
8. **Teste correspondente.** Toda `Fnn` entra com teste unitário de mutação e, quando envolve rede,
   teste de integração de sala. Ver `DOC-052`.
