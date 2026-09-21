# Guia rápido: Command e Template Method

| Campo            | Valor                                             |
| ---------------- | ------------------------------------------------- |
| **ID**           | `DOC-099`                                         |
| **Status**       | Ativo                                             |
| **Vale para**    | `apps/game-server`                                |
| **Versão longa** | [`DOC-097`](padroes_command_e_template_method.md) |

---

## Pra que serve este documento

O DOC-097 explica os dois padrões com o código na mão. Este aqui é a versão
curta: o que cada um resolve, um exemplo, e só.

---

## Command

**O problema.** O desfazer funcionava, mas dependia de disciplina. A Room
registrava a fotografia do estado numa linha e executava a ação na linha
seguinte:

```ts
jornal.registrar(...);   // tira a foto
handler.executa(...);    // muda o estado
```

Inverter essas duas linhas não quebrava teste nenhum. Só que a foto passava a
sair _depois_ da mudança — e aí o desfazer virava um nada silencioso: o jogador
clica, o log diz que desfez, e o estado não volta.

**A ideia.** Em vez da Room lembrar de fotografar na hora certa, a própria ação
guarda o que precisa pra se desfazer.

**Como ficou.** Todo comando responde três perguntas:

```ts
interface ComandoDeMesa {
  executar(): void;
  reversivel(): boolean;
  desfazer(): void;
}
```

O `ComandoDeIntencao` captura o estado anterior imediatamente antes de mutar —
não dá mais pra trocar a ordem, porque é o mesmo passo. O
`HistoricoDeComandos` guarda o último comando de cada jogador:

```ts
historico.executar(comando); // executa e lembra
historico.desfazer(sid); // devolve o que foi desfeito, ou null
```

Vale dizer por que é fotografia e não operação inversa: um inverso por intenção
seriam noventa e seis inversos, e o de "embaralhou e comprou três" teria que
guardar a ordem anterior de qualquer jeito.

---

## Template Method

**O problema.** Rolar dado, girar moeda, sortear jogador, sortear carta e
descartar ao acaso não pareciam parecidas — uma muda o estado, outra só
transmite, outra só escreve no log. Mas todas fazem os mesmos cinco passos:
pode? sorteia, aplica, anuncia, registra. Cada uma repetia o roteiro à mão, e
dava pra esquecer um passo. Normalmente o log.

**A ideia.** Escrever o roteiro uma vez, na classe-base, e deixar cada ação
preencher só os buracos dela.

**Como ficou.** `AcaoDeSorteio` tem o roteiro em `executa()`. A subclasse
preenche:

| Passo                     | Obrigatório? |
| ------------------------- | ------------ |
| `sortear()`               | sim          |
| `narrar()`                | sim          |
| `permitido()`             | não          |
| `aplicar()`, `anunciar()` | não          |

`GirarMoeda` inteiro é pouco mais que duas funções:

```ts
protected override sortear(): 'CARA' | 'COROA' { ... }
protected override narrar(...): LogEvent { ... }
```

Duas regras do projeto passaram a se verificar sozinhas. O acaso mora num passo
com nome, então o revisor sabe onde olhar em vez de varrer o handler inteiro
(RN06). E `narrar` é abstrato: não existe subclasse que esqueça o log, porque
sem a frase o código não compila.

---

## O que não mudou

O comportamento da mesa. Os 167 testes que já existiam continuam passando.

---

## Onde ver mais

- [`DOC-097`](padroes_command_e_template_method.md) — a versão completa
- `docs/diagramas/command.png` e `docs/diagramas/template_method.png` — os
  diagramas de classe
