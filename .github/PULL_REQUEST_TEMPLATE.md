## O que muda, e por quê

<!-- O QUE está no diff. Escreva o PORQUÊ: que defeito isto corrige, ou que
     alternativa foi descartada e por qual motivo. -->

## Como verificar

<!-- Os passos para quem revisa reproduzir. Se for da mesa, diga com quantos
     jogadores — a maioria dos defeitos de mesa só aparece com dois ou mais. -->

## Checklist

- [ ] `pnpm verificar` passa
- [ ] Comportamento novo tem teste; correção tem o teste que falhava antes dela
- [ ] Mexeu em render, geometria ou conexão da mesa → E2E multijogador rodado ([DOC-092 §2](../docs/politica_de_testes.md))
- [ ] Documentos afetados atualizados **neste PR** ([DOC-093 §2](../docs/politica_de_documentacao.md))
- [ ] Gerados regerados: `pnpm docs:estado`, `pnpm schema:sync`
- [ ] Variável de ambiente nova está em `.env.example` **e** no `render.yaml`
- [ ] Nenhum segredo no diff
- [ ] Commits sem atribuição a ferramenta

## Armadilhas que este diff encosta

<!-- Marque as que se aplicam — elas mudam o que o revisor precisa olhar. -->

- [ ] Campo novo em schema do Colyseus (**vai no fim**, e `pnpm schema:sync`)
- [ ] Intenção nova (contrato + `REGISTRY` + `net/intents.ts`, os três)
- [ ] Ação restrita ao anfitrião (usa `exigirAnfitriao`, não `seat === 0` à mão)
- [ ] Aleatoriedade (só por `services/rng.ts` — RN06)
- [ ] Handler de intenção (sem I/O: `await` no caminho crítico segura a sala)
- [ ] Visibilidade de zona oculta (`podeVer` + reconciliação)
- [ ] Caminho de entrada na mesa (`seatToken` é de uso único)
