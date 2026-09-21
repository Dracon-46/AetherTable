# Guia rápido: Iterator e Chain of Responsibility

| Campo            | Valor                                                      |
| ---------------- | ---------------------------------------------------------- |
| **ID**           | `DOC-098`                                                  |
| **Status**       | Ativo                                                      |
| **Vale para**    | `apps/game-server`                                         |
| **Versão longa** | [`DOC-096`](padroes_iterator_e_chain_of_responsibility.md) |

---

## Pra que serve este documento

O DOC-096 explica os dois padrões com o código na mão. Este aqui é a versão
curta: o que cada um resolve, um exemplo, e só.

---

## Iterator

**O problema.** Pra percorrer as cartas de uma zona, quem escrevia o código
precisava saber três coisas que não tinham nada a ver com a tarefa dele: que o
topo do grimório é o _fim_ da lista, que a lista guarda ids e não cartas, e que
um id pode apontar pra uma carta que não existe mais. Quinze lugares do servidor
sabiam disso. Cada um dos quinze podia aprender errado — e um aprendeu: o
embaralhar com "manter o topo" embaralhava o topo junto.

**A ideia.** Quem percorre não devia saber como a lista é guardada. Devia só
pedir o próximo.

**Como ficou.** A `ZonaDeCartas` embrulha a zona e devolve um iterador:

```ts
const zona = new ZonaDeCartas(state, sid, 'LIBRARY');

for (const carta of zona.percorrer('TOPO', 3)) {
  // as três do topo, já como Card, já sem os ids órfãos
}
```

Tirar do topo é o mesmo gesto, com outro verbo:

```ts
for (const carta of zona.retirar('TOPO', 2)) {
  // as duas saíram da zona
}
```

A mesa de assentos usa a mesma interface pra girar em círculo a partir de quem
está na vez.

O ganho é esse: a regra de "como a zona é guardada" passou a morar em um
arquivo. Os outros quinze lugares escrevem `for...of` e pronto.

---

## Chain of Responsibility

**O problema.** Toda intenção que chega passa por seis verificações antes de
virar mutação. Passou do limite de mensagens? É sorteio demais? Quem mandou é
espectador? O corpo da mensagem é válido? Tem permissão?

A ordem entre elas importa. Espectador é checado antes de validar o corpo,
porque não faz sentido validar o pedido de quem não pode pedir nada. Só que isso
tudo era uma função de 110 linhas com `if` dentro de `if`, e o único registro da
ordem era um comentário pedindo pra ninguém mexer.

**A ideia.** Cada verificação vira um elo. O elo olha o pedido e decide: barra
aqui, ou passa adiante.

**Como ficou.** Seis elos, nesta ordem:

1. `LimiteDeIntencoes`
2. `LimiteDeSorteios`
3. `BarreiraDeEspectador`
4. `ValidacaoDePayload`
5. `Autorizacao`
6. `ExecucaoDoHandler` — o único que encosta no estado

A ordem deixou de ser um comentário e virou a lista em `correnteDaMesa`. Cada
elo tem nome próprio e teste próprio.

---

## O que não mudou

O comportamento da mesa. Os 167 testes que já existiam continuam passando, e
nenhum deles precisou ser tocado.

---

## Onde ver mais

- [`DOC-096`](padroes_iterator_e_chain_of_responsibility.md) — a versão completa
- `docs/diagramas/iterator.png` e `docs/diagramas/chain_of_responsibility.png` —
  os diagramas de classe
