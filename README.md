# AetherTable

Plataforma web _sandbox_ multiformato para Magic: The Gathering.

**Não existe motor de regras.** O sistema move peças, sincroniza estado e
esconde informação — quem aplica as regras é a mesa. Essa é a decisão de
projeto mais importante do repositório (RN01) e a razão de várias coisas
serem como são: o cronômetro conta e avisa mas nunca passa o turno; a vida a
zero elimina, mas o eliminado continua sentado; o nível de poder da sala é uma
etiqueta declarada, não um cálculo.

## Começando

Requisitos: **Node 22**, **pnpm 9**, e um Postgres alcançável.

```bash
pnpm install
cp .env.example .env                                  # ajuste DATABASE_URL e JWT_SECRET
pnpm --filter backend-core exec prisma generate
pnpm --filter @aethertable/shared-types build
pnpm dev
```

| Serviço      | Porta | O quê                                  |
| ------------ | ----- | -------------------------------------- |
| frontend     | 3030  | Next.js                                |
| backend-core | 3333  | NestJS — contas, decks, passes de mesa |
| game-server  | 2567  | Colyseus — o estado da partida, em RAM |

> As portas **3000–3020** são reservadas neste ambiente e nada do projeto pode
> cair nelas. `pnpm dev:kill` derruba tudo e libera as três.

Detalhes em [`docs/guia_de_configuracao_e_desenvolvimento.md`](docs/guia_de_configuracao_e_desenvolvimento.md).

## Arquitetura em três parágrafos

**`apps/backend-core`** (NestJS + Prisma + Postgres) guarda o que precisa
sobreviver à partida: contas, grimórios, cosméticos, resumo pós-partida. Ele
emite o `seatToken` — assinado, de uso único, vinculado a uma sala — que é a
única forma de entrar numa mesa.

**`apps/game-server`** (Colyseus) guarda o que **não** sobrevive: o estado da
sala vive em RAM e nunca no Postgres (ADR-006, RN12), porque muta dezenas de
vezes por segundo e não vale nada depois. Toda mensagem do cliente é uma
_intenção_ validada por zod, autorizada e aplicada num registry — o único
lugar do sistema onde uma mensagem vira mutação de estado.

**`apps/frontend`** (Next.js + Konva) desenha a mesa e nunca envia estado, só
intenções. **`packages/shared-types`** é a fonte única dos tipos de domínio
(ADR-007): mudar um campo lá deve **quebrar a compilação** de quem não
acompanhou — é o comportamento desejado, não um efeito colateral.

## Comandos

```bash
pnpm dev              # os três serviços
pnpm dev:kill         # derruba tudo e libera as portas
pnpm verificar        # A BATERIA COMPLETA — rode antes de subir
pnpm test             # só os testes de unidade
pnpm schema:sync      # regenera o mirror de schema do cliente
pnpm docs:estado      # regenera a paridade de intenções
```

### Três armadilhas que valem o minuto de leitura

1. **`@colyseus/schema` serializa por ÍNDICE.** Campo novo em `RoomState`,
   `Player` ou `Card` vai **no fim**. Inserir no meio desloca todos os
   seguintes e o cliente decodifica lixo — sem erro, sem aviso. Rode
   `pnpm schema:sync` depois de tocar qualquer schema.
2. **Aleatoriedade só por `services/rng.ts`** (RN06). O ESLint bloqueia
   `Math.random()` no game-server: num jogo onde a ordem do grimório é
   informação oculta, um PRNG previsível é trapaça sem rastro.
3. **Ação de mesa que só o dono pode fazer usa `exigirAnfitriao`.** Escrever a
   checagem de `seat === 0` à mão foi o que deixou `INTENT_RESET_MATCH` e
   `INTENT_SET_TURN_ORDER` abertos para qualquer jogador.

## Contribuindo

Leia o [`CONTRIBUTING.md`](CONTRIBUTING.md). O resumo:

- Git Flow — `feature/*` sai de `develop`; `main` só recebe release e hotfix,
  sempre com tag ([DOC-091](docs/fluxo_de_trabalho_git.md)).
- `pnpm verificar` passa antes de subir; comportamento novo vem com o teste
  que o prova ([DOC-092](docs/politica_de_testes.md)).
- Documento afetado é atualizado no mesmo PR
  ([DOC-093](docs/politica_de_documentacao.md)).
- Comentário explica o **defeito que a linha corrige**, não o que o código faz.

## Documentação

O índice completo está em [`docs/readme.md`](docs/readme.md). Os mais
consultados:

| Documento                                                        | Para quê                                    |
| ---------------------------------------------------------------- | ------------------------------------------- |
| [Visão do projeto](docs/documento_de_visao_do_projeto.md)        | o que estamos construindo, e para quem      |
| [Motor sandbox](docs/especificacao_do_motor_sandbox.md)          | o estado da sala, campo a campo             |
| [WebSocket e eventos](docs/especificacao_websocket_e_eventos.md) | o contrato de intenções                     |
| [Modelo de dados](docs/modelo_de_dados.md)                       | o que é persistido, e o que não é           |
| [Regras de negócio](docs/regras_de_negocio_e_casos_de_uso.md)    | RN01…RN13                                   |
| [Estado de implementação](docs/estado_de_implementacao.md)       | gerado — paridade contrato/servidor/cliente |

## Licença

UNLICENSED — uso privado. Magic: The Gathering é marca da Wizards of the
Coast, que não patrocina nem endossa este projeto. Os dados de carta vêm da
[Scryfall](https://scryfall.com); nenhuma imagem ou texto de carta é
redistribuído por este repositório.
