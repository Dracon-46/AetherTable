# Changelog

As mudanças de cada versão do AetherTable. O formato segue o
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o
[SemVer](https://semver.org/lang/pt-BR/), conforme o
[DOC-091 §3](docs/fluxo_de_trabalho_git.md).

A nota completa de cada versão é a mensagem da tag anotada, publicada na aba
[Releases](https://github.com/Dracon-46/AetherTable/releases). Este arquivo é o
resumo.

## [Não lançado]

## [0.12.0] — 2026-10-30

### Alterado

- **Telas de entrada no sistema visual da Falkyria:** login, cadastro e as
  duas telas de senha agora usam os tokens, as fontes (Geist e Instrument
  Serif), o cartão e o fundo do site e do painel do Nicx, nos dois temas.
- **Dragão novo na entrada:** a imagem de fundo com fogo deu lugar a um
  mascote vetorial no estilo do Nicx, que fecha os olhos enquanto a senha é
  digitada, acende no envio e recusa quando dá erro.

### Removido

- A cena antiga do dragão (`dragon_bg.png`, 748 KB, e o fogo em canvas).

## [0.11.0] — 2026-10-30

### Adicionado

- **Identidade de produto Falkyria:** ícone próprio do AetherTable (aba,
  atalho na tela inicial e manifesto do app web) e o selo "Um produto
  Falkyria" na entrada, no menu do painel e na política de privacidade.

### Alterado

- **Dependências:** dotenv 18, pino 10 e jest 30.
- **Licença** no modelo dos produtos Falkyria, com a proteção explícita do
  nome e das logos.

## [0.10.1] — 2026-10-21

### Corrigido

- **Desfazer depois de jogar uma carta da mão:** o undo lançava "Erro interno
  na mesa" sempre que uma zona do jogador tinha encolhido (o `splice` do
  Colyseus 3 não insere mais do que remove), e deixava a carta com a zona da
  mão listada no campo. A lista agora cresce antes de ser reescrita.

### Alterado

- **O desfazer da mesa segue o padrão Memento** (`DOC-098`): a foto do estado
  só é lida por quem a tirou, e uma foto de outra mesa ou de outro jogador é
  recusada. Sem mudança visível na mesa.

## [0.10.0] — 2026-10-19

### Adicionado

- **Desafios na conta:** recorde e sequência atual de cada desafio ficam em
  `progresso_de_desafios`. Trocar de computador não zera mais, e o recorde que
  estava no navegador sobe para a conta na primeira visita. O recorde só sobe,
  sem corrida entre abas ou aparelhos.
- **Sino na conta:** o "já vi" das notificações e a última novidade lida
  (`GET/PUT /notificacoes/leitura`); vale o mais recente entre o navegador e a
  conta.
- **Aparência do site na conta** (`preferenciasDeInterface`): visão,
  agrupamento e ordenação dos decks, tamanho de carta, densidade, animações e
  idiomas.
- **Mais preferências de mesa na conta:** log dividido, rastreador de mana,
  prévia ao lado, efeitos sonoros e tremor do comandante.
- **Fichas recentes na conta** (`fichasRecentes`).

### Alterado

- Sair no meio de uma pergunta de desafio conta como erro e zera a sequência.
  Sem isso, recarregar a página viraria um jeito de pular a pergunta difícil
  sem perder a sequência.
- Uma conta sem preferências salvas passa a enviar o que for ajustado; antes,
  nada chegava à conta até a primeira gravação por outro caminho.
- O release marcado como "Latest" no GitHub é sempre a maior versão estável.

## [0.9.6] — 2026-10-19

### Segurança

- **Mesa:** o servidor de jogo exige a audiência do passe de mesa. O token de sessão da API não
  serve mais como passe universal, e o passe de configuração também não.
- **Mesa:** salas só são criadas ou reservadas depois de validar o passe (`onAuth` estático).
  O matchmaker expõe só `joinOrCreate` e `reconnect`, com CORS restrito e corpo de até 8 KB.
- **Mesa:** a ordem do grimório deixa de vazar. As cartas nascem embaralhadas e ganham id novo a
  cada embaralhamento de zona oculta, e devolver uma zona embaralhando não se desfaz mais.
- **Mesa:** tetos contra estado inchado (fichas, cartas, contadores, setas, revelações), cota para
  mensagens sociais e desconexão de quem inunda a sala.
- **Voz:** a credencial do LiveKit exige o passe de voz que o servidor de jogo emite só para quem
  entrou na sala.
- **Contas:** o vínculo com Google ou Discord numa conta criada por senha e nunca confirmada apaga
  a senha e derruba as sessões, fechando a tomada de conta antes do cadastro.
- **API:**
  - tokens e segredos censurados no log;
  - JWT só HS256, e segredo curto recusado em produção;
  - tetos de decks e de cartas por conta;
  - fila da Scryfall protegida contra saturação;
  - `GET /flags` e o Explorar sem campos internos.
- **Site:**
  - login por `#token=` aceito só no fluxo que a própria aba iniciou;
  - cabeçalhos de segurança (CSP em modo de relatório);
  - fonte e ícones servidos pelo próprio site.
- **Dependências:**
  - Next 15.5.28, com correção de execução remota de código no otimizador de imagem;
  - NestJS 11.2.7, Colyseus 0.16.26, undici 7.30;
  - overrides de `proxy-addr`, `qs`, `js-yaml`, `postcss` e `sharp`.
- **Infra:** imagens Docker fixadas por versão e digest; serviços locais do `docker compose` só em
  localhost.

### Corrigido

- O CI da `main` estava vermelho: um teste do servidor de jogo dependia do `.env` local.
- Imagem de carta que falhava ficava em cache e a carta virada para cima aparecia como verso.
- A animação do mascote nunca andava, e o playmat era recodificado a cada mudança de jogador.
- A votação de remoção numa mesa de dois virava expulsão unilateral.
- O resumo da partida se perdia no deploy, porque o `onDispose` não esperava o envio.

### Alterado

- ESLint com tipos (`recommendedTypeChecked` + `stylisticTypeChecked`) e zero aviso em todos os
  pacotes; o typecheck passa a cobrir os testes.
- CI reorganizado, com action de preparo compartilhada, testes do `scryfall-client`, build das
  imagens Docker e o check agregador `CI ok`. Entram CodeQL, revisão de dependências no PR,
  release automático pela tag, sincronia da Wiki e Dependabot.
- Licença proprietária da Falkyria, política de segurança, código de conduta, CODEOWNERS,
  formulários de issue e Wiki (fonte em `docs/wiki/`).

## [0.9.5] — 2026-10-16

### Corrigido

- O servidor de jogo alcança a API pelo endereço público: no plano gratuito do
  Render a rede interna não recebe tráfego, e o grimório não carregava.
- Sem chave do LiveKit, a voz fica desligada em vez de dar erro.

## [0.9.4] — 2026-10-16

### Corrigido

- O menu do cartão de deck aparece inteiro.

## [0.9.3] — 2026-10-15

### Corrigido

- O site aponta para o servidor de jogo atual, e a vitrine de mesas deixa de dar
  erro de CORS.

## [0.9.2] — 2026-10-15

### Corrigido

- Busca de carta sem resultado responde lista vazia, não 404.

## [0.9.1] — 2026-10-15

### Corrigido

- A API volta ao ar: a migração passa a usar a conexão direta do Neon, onde o
  _advisory lock_ do Prisma funciona.

## [0.9.0] — 2026-10-14

### Adicionado

- Histórico de partidas (resumo: decks, comandantes, vida final, vencedor), sem
  replay.
- Draft, desafios e decks prontos; placa de nome, comentários, pastas, idioma e
  i18n das telas de entrada.

## [0.8.0] — 2026-10-14

### Adicionado

- Paridade com o EDHPlay na mesa: olhar X do topo ou do fundo com reordenação,
  pilha (STACK), reações, rastreador de mana, dados, fichas personalizadas.
- Fora da mesa: favoritos, clonar e filtros nos decks; Explorar com decks
  públicos, curtidas e cópia; excluir a própria conta nos Ajustes.

### Corrigido

- Varredura de defeitos relatados em mesa: vida inicial combinada, imposto ao
  arrastar o comandante, partida 1×1.

## [0.7.1] — 2026-09-21

### Adicionado

- Política de privacidade publicada, o que destrava o login com Google fora do
  modo de teste.

## [0.7.0] — 2026-09-21

### Adicionado

- Recuperação de senha por e-mail (link de 30 minutos e uso único).

### Corrigido

- O login com Google e com Discord passa a funcionar fora da máquina de
  desenvolvimento.

## [0.6.0] — 2026-09-16

### Corrigido

- A mesa aguenta uma partida de três horas: o F5 volta para a mesa, e uma série de
  defeitos que só apareciam em partida longa.

## [0.5.0] — 2026-09-11

### Corrigido

- O formato da mesa volta a ser escolha do jogador.
- O administrador consegue socorrer uma conta sem conhecer senha nenhuma.

## [0.4.0] — 2026-09-10

### Corrigido

- Revelar o topo do grimório volta a funcionar; a ordem real das zonas e o menu
  do grimório voltam.

## [0.3.0] — 2026-09-09

### Adicionado

- Estatísticas da conta.

### Segurança

- Monitor do Colyseus fechado com autenticação; o servidor de jogo recusa subir
  em produção sem a senha.
- O logout passa a invalidar a sessão no servidor.
- O token sai da querystring.
- O cadeado de cosmético passa a trancar de verdade.

## [0.2.0] — 2026-09-09

### Adicionado

- Configuração de sala na criação, vitrine de mesas públicas, regras combinadas
  na sala de espera e modo espectador.
- Processo documentado (DOC-091/092/093), `pnpm verificar` e hook de pre-push.

[Não lançado]: https://github.com/Dracon-46/AetherTable/compare/v0.12.0...HEAD
[0.12.0]: https://github.com/Dracon-46/AetherTable/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/Dracon-46/AetherTable/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/Dracon-46/AetherTable/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/Dracon-46/AetherTable/compare/v0.9.6...v0.10.0
[0.9.6]: https://github.com/Dracon-46/AetherTable/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/Dracon-46/AetherTable/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/Dracon-46/AetherTable/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/Dracon-46/AetherTable/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/Dracon-46/AetherTable/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/Dracon-46/AetherTable/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/Dracon-46/AetherTable/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/Dracon-46/AetherTable/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/Dracon-46/AetherTable/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/Dracon-46/AetherTable/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Dracon-46/AetherTable/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Dracon-46/AetherTable/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Dracon-46/AetherTable/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Dracon-46/AetherTable/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Dracon-46/AetherTable/releases/tag/v0.2.0
