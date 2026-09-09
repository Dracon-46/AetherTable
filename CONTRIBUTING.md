# Contribuindo com o AetherTable

Três documentos governam o trabalho aqui, e este arquivo é o índice deles:

|             | Documento                                                    | Responde                                                        |
| ----------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| **DOC-091** | [Fluxo de Trabalho Git](docs/fluxo_de_trabalho_git.md)       | de onde sai a branch, para onde ela volta, quando nasce uma tag |
| **DOC-092** | [Política de Testes](docs/politica_de_testes.md)             | o que roda antes de subir, e qual teste acompanha qual mudança  |
| **DOC-093** | [Política de Documentação](docs/politica_de_documentacao.md) | qual documento é atualizado junto com o código                  |

## O ciclo, do início ao fim

```bash
# 1. sai da develop, nunca da main
git checkout develop && git pull
git checkout -b feature/<assunto>

# 2. trabalhe. commits pequenos, mensagem dizendo o PORQUÊ.

# 3. a bateria completa
pnpm verificar

# 4. mexeu no render ou na conexão da mesa? o E2E também — ver DOC-092 §2
# 5. suba e abra o PR contra `develop`
git push -u origin feature/<assunto>
```

## Antes de abrir o pull request

- [ ] `pnpm verificar` passa
- [ ] Comportamento novo tem teste; correção de defeito tem o teste que
      falhava antes dela
- [ ] Mexeu em render/conexão da mesa → E2E multijogador rodado (DOC-092 §2)
- [ ] Documentos da tabela do DOC-093 §2 atualizados **neste PR**
- [ ] Gerados regerados: `pnpm docs:estado`, `pnpm schema:sync`
- [ ] Variável de ambiente nova está em `.env.example` **e** no `render.yaml`
- [ ] Nenhum segredo no diff
- [ ] Mensagens de commit sem atribuição a ferramenta

## As regras que não são negociáveis

**Uma branch, um assunto.** Um diff de dois assuntos é revisado com metade da
atenção em cada um.

**`--no-ff` em todo merge de feature.** Sem ele a fronteira da feature some do
histórico, e com ela a possibilidade de reverter a feature inteira.

**Sem atribuição a ferramenta no commit.** Sem `Co-Authored-By` de assistente,
sem "Generated with", sem emoji de robô. O autor do commit é quem responde
pelo código; uma ferramenta não responde por nada.

**Comentário explica o defeito que a linha corrige** ou a alternativa que foi
descartada — não o que o código faz. Português com acento, cabeçalho de
arquivo com o bloco `─── TÍTULO ───`.

**Nunca afrouxe um teste para ele passar.** Se o comportamento novo é o certo,
reescreva a asserção sobre a invariante e diga no comentário o que mudou.

## As armadilhas deste repositório

Cada uma já causou um defeito documentado no próprio código.

1. **`@colyseus/schema` serializa por ÍNDICE.** Campo novo vai no fim.
   `pnpm schema:sync` depois de tocar qualquer schema.
2. **Intenção emitida sem handler é descartada em silêncio.** Mantenha
   `IntentPayloadMap`, o `REGISTRY` e `net/intents.ts` alinhados;
   `pnpm docs:estado` fecha o contador.
3. **Ação de mesa restrita usa `exigirAnfitriao(ctx, 'INTENT_X')`.** A
   checagem à mão de `seat === 0` foi o que deixou `INTENT_RESET_MATCH` e
   `INTENT_SET_TURN_ORDER` abertos.
4. **Aleatoriedade só por `services/rng.ts`** (RN06). O ESLint bloqueia
   `Math.random()` no game-server.
5. **Handler de intenção é SÍNCRONO.** Um `await` no caminho crítico segura a
   fila da sala inteira. O que precisa de I/O vive na `Room`.
6. **`window.location.href` em `dashboard/page.tsx` não vira `router.push`.**
   Tem um bloco em caixa alta explicando que a troca quebra a entrada na mesa:
   o `seatToken` é de uso único e o StrictMode invoca o efeito duas vezes.
7. **Antes de mexer no render ou na conexão da mesa, rode o E2E
   multijogador.** Todos os defeitos relatados por jogador passaram por um
   `pnpm test` verde.

## Reportando um defeito

Abra uma issue com: o que você fez, o que esperava, o que aconteceu, e — se
for da mesa — quantos jogadores estavam na sala. O número de jogadores importa
mais do que parece: a maioria dos defeitos de mesa só aparece com dois ou mais.
