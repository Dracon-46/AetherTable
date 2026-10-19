# Glossário

Termos do projeto, em ordem alfabética. Termos de Magic seguem a tradução
oficial em português quando ela existe.

| Termo                       | Significado                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anfitrião**               | quem criou a sala. Só ele inicia a partida, reinicia, muda a ordem dos turnos e remove jogadores (`exigirAnfitriao`).                                         |
| **Atribuição a ferramenta** | linha de commit que credita um assistente (`Co-Authored-By`, "Generated with"). Proibida no projeto.                                                          |
| **Comandante**              | no formato Commander, a criatura lendária que lidera o deck e começa na zona de comando.                                                                      |
| **CSPRNG**                  | gerador de números aleatórios criptograficamente seguro (`crypto.randomInt`). O único permitido para embaralhar (RN06).                                       |
| **Espectador**              | quem assiste à mesa sem assento. Não vê zona oculta de ninguém e não pratica ação de jogo.                                                                    |
| **Espelho de schema**       | cópia das classes de schema do servidor de jogo em `apps/frontend/src/net/schema`, gerada por `pnpm schema:sync`.                                             |
| **Grimório**                | o deck durante a partida (_library_). Zona oculta: a ordem é informação secreta.                                                                              |
| **Intenção**                | mensagem do cliente pedindo uma mudança (`INTENT_MOVE_CARD`, `INTENT_SHUFFLE`…). O servidor valida, autoriza e aplica, ou descarta.                           |
| **Mesa**                    | a partida em andamento, servida por uma sala do Colyseus.                                                                                                     |
| **Passe de mesa**           | `seatToken`: JWT emitido pela API, de uso único, preso a uma sala. A única forma de entrar numa mesa.                                                         |
| **Passe de voz**            | JWT emitido pelo servidor de jogo depois que a entrada é aceita. A API só dá credencial do LiveKit com ele.                                                   |
| **RN01, RN06, RN12…**       | regras de negócio invariáveis, numeradas em [Regras de negócio](https://github.com/Dracon-46/AetherTable/blob/main/docs/regras_de_negocio_e_casos_de_uso.md). |
| **Registry**                | o mapa `INTENT_* → handler` do servidor de jogo. Único lugar onde mensagem vira mudança de estado.                                                            |
| **Sala de espera**          | a fase antes da partida: escolha de deck, regras combinadas, ordem de assentos.                                                                               |
| **Sandbox**                 | o modelo do produto: o sistema move peças e esconde informação, mas não aplica as regras do jogo (RN01).                                                      |
| **Taverna**                 | o painel inicial depois do login: criar mesa, entrar por código, vitrine de mesas públicas.                                                                   |
| **Vista**                   | o recorte do estado que um cliente recebe. Cada jogador vê a própria mão; ninguém vê o grimório.                                                              |
| **Vitrine**                 | a lista de mesas públicas (`GET /salas` no servidor de jogo).                                                                                                 |
| **Zona oculta**             | zona cujo conteúdo não é público: mão e grimório. Cartas viradas para baixo seguem a mesma regra.                                                             |
