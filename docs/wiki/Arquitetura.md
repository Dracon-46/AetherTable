# Arquitetura

Detalhe e decisões registradas (ADRs) em
[`docs/documento_de_arquitetura_de_software_sad.md`](https://github.com/Dracon-46/AetherTable/blob/main/docs/documento_de_arquitetura_de_software_sad.md).

## O monorepo

```
apps/
  backend-core/   API REST (NestJS + Prisma + Postgres)
  game-server/    servidor de jogo autoritativo (Colyseus)
  frontend/       site e mesa (Next.js + Konva)
packages/
  shared-types/      tipos de domínio, fonte única para os três apps (ADR-007)
  scryfall-client/   o único cliente da Scryfall: fila de 100 ms e backoff
tools/             scripts do repositório (dev, verificar, schema-sync…)
docs/              especificações; docs/wiki é a fonte desta Wiki
```

pnpm workspaces + Turborepo. `shared-types` é importado pelo `dist`: mudar um
campo lá **deve quebrar a compilação** de quem não acompanhou. É o
comportamento desejado.

## O que cada serviço guarda

**API (`backend-core`)** guarda o que sobrevive à partida: contas, decks,
cosméticos e o resumo de cada partida. Ela emite o **passe de mesa**
(`seatToken`): um JWT assinado, de uso único e preso a uma sala, que é a única
forma de entrar numa mesa.

**Servidor de jogo (`game-server`)** guarda o que **não** sobrevive: o estado da
sala vive em RAM e nunca no Postgres (RN12), porque muda dezenas de vezes por
segundo e não vale nada depois. Toda mensagem do cliente é uma **intenção**,
que é validada por zod, autorizada e aplicada num registry. Esse registry é o
único lugar do sistema onde uma mensagem vira mudança de estado.

**Site (`frontend`)** desenha a mesa e nunca envia estado, só intenções. O
estado chega do servidor por _patches_ do `@colyseus/schema`, já filtrados: cada
cliente recebe só o que pode ver.

## O caminho de uma jogada

```
jogador arrasta a carta
  → frontend envia INTENT_MOVE_CARD { id, x, y }
    → game-server: zod valida o formato
                   o dispatcher confere papel (jogador, controlador, anfitrião)
                   o handler muda o estado (sem I/O, sem await)
      → @colyseus/schema gera o patch
        → cada cliente recebe a sua VISTA (mão e grimório alheios ficam de fora)
```

## Invariantes que não se negociam

| Regra    | O que diz                              | Por que importa                                                                     |
| -------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| **RN01** | não existe motor de regras             | o sistema move peças; quem joga aplica as regras                                    |
| **RN06** | aleatoriedade só por `services/rng.ts` | embaralhar com PRNG previsível é trapaça sem rastro; o ESLint barra `Math.random()` |
| **RN12** | estado da sala só em RAM               | latência e simplicidade; o banco guarda só o resumo                                 |

## Três armadilhas

1. **`@colyseus/schema` serializa por ÍNDICE.** Campo novo vai **no fim** da
   classe. Inserir no meio desloca os seguintes e o cliente decodifica lixo, sem
   erro. Depois de mexer em schema: `pnpm schema:sync`.
2. **Intenção sem handler é descartada em silêncio** pelo Colyseus. Contrato,
   `REGISTRY` e `net/intents.ts` andam juntos; `pnpm docs:estado` confere.
3. **Ação restrita ao anfitrião usa `exigirAnfitriao`.** A checagem à mão de
   `seat === 0` já deixou ações de anfitrião abertas para qualquer jogador.

## Documentos de referência

- [Motor sandbox](https://github.com/Dracon-46/AetherTable/blob/main/docs/especificacao_do_motor_sandbox.md): o estado da sala, campo a campo;
- [WebSocket e eventos](https://github.com/Dracon-46/AetherTable/blob/main/docs/especificacao_websocket_e_eventos.md): o contrato de intenções;
- [API backend](https://github.com/Dracon-46/AetherTable/blob/main/docs/especificacao_da_api_backend.md): rotas, payloads e erros;
- [Modelo de dados](https://github.com/Dracon-46/AetherTable/blob/main/docs/modelo_de_dados.md): o que é persistido e o que não é.
