# Fluxo de Trabalho Git

| Campo         | Valor                                 |
| ------------- | ------------------------------------- |
| **ID**        | `DOC-091`                             |
| **Modelo**    | Git Flow (Vincent Driessen), adaptado |
| **Vale para** | todo commit deste repositório         |

## 1. Por que este documento existe

O repositório vinha sendo tocado com uma branch por assunto e merge direto na
`main`. Funciona com uma pessoa; deixa de funcionar no primeiro dos três casos
abaixo, e todos os três já estão no horizonte:

1. **Corrigir produção sem levar junto o que está pela metade.** Com um só
   tronco, a correção urgente carrega tudo que foi mesclado desde o último
   deploy — inclusive o que ainda não foi verificado em produção.
2. **Saber o que está no ar.** Sem tag, "a versão de produção" é um hash que
   alguém precisa lembrar. Com tag, é um nome.
3. **Ter onde integrar sem publicar.** Duas features que funcionam sozinhas
   podem quebrar juntas, e o lugar de descobrir isso não é a `main`.

## 2. As branches, e o que cada uma promete

| Branch      | Vida       | Promessa                                                 | Nasce de  | Volta para             |
| ----------- | ---------- | -------------------------------------------------------- | --------- | ---------------------- |
| `main`      | eterna     | **Só o que está em produção.** Todo commit aqui tem tag. | —         | —                      |
| `develop`   | eterna     | O próximo release, integrado e verde.                    | `main`    | —                      |
| `feature/*` | temporária | Um assunto.                                              | `develop` | `develop`              |
| `release/*` | temporária | Estabilizar o que vai sair.                              | `develop` | `main` **e** `develop` |
| `hotfix/*`  | temporária | Corrigir produção AGORA.                                 | `main`    | `main` **e** `develop` |

### `main` — o que está no ar

Ninguém commita direto nela. Ela só recebe merge de `release/*` ou `hotfix/*`,
e todo merge é seguido de uma tag. A regra prática: **se você não consegue
apontar a tag, não está em produção.**

### `develop` — o próximo release

É o tronco do dia a dia. Toda feature sai dela e volta para ela. Ela precisa
estar sempre verde — o CI roda nela pelo mesmo motivo que roda na `main`: uma
`develop` quebrada bloqueia todo mundo, não só quem quebrou.

### `feature/*` — um assunto por branch

Nome: `feature/<assunto-em-kebab-case>`. Curto e descritivo do QUE, não do
como: `feature/modo-espectador`, não `feature/mexer-no-onauth`.

> **Uma branch, um assunto.** A tentação é aproveitar a branch aberta para
> "já que estou aqui, arrumo isto também". O custo aparece na revisão: um
> diff de dois assuntos é revisado com metade da atenção em cada um, e no dia
> em que um deles precisar ser revertido os dois voltam juntos.

### `release/*` — a janela de estabilização

Nome: `release/vX.Y.Z`. Nasce quando `develop` tem o suficiente para sair.

A partir do corte, ela recebe **apenas** correção de defeito, ajuste de versão
e documentação — nunca funcionalidade nova. É isso que a torna útil: enquanto
ela estabiliza, a `develop` segue recebendo o que vai no release seguinte, sem
empurrar o atual.

### `hotfix/*` — o caminho curto para produção

Nome: `hotfix/vX.Y.Z`. Nasce da **`main`**, não da `develop` — esse é o ponto
inteiro. Sair da `develop` levaria para produção tudo que foi integrado desde
o último release, que é exatamente o que uma correção urgente não pode fazer.

Ele volta para as duas: `main` (para ir ao ar) e `develop` (senão o próximo
release reintroduz o defeito).

## 3. Versionamento

[SemVer](https://semver.org/lang/pt-BR/), com o "público" sendo o jogador e as
integrações:

- **MAJOR** — quebra o que já existia: migração destrutiva, contrato de
  intenção removido, formato de save incompatível.
- **MINOR** — funcionalidade nova compatível. É o caso da maioria dos releases.
- **PATCH** — correção sem funcionalidade nova.

Tag **anotada**, sempre — nunca leve:

```bash
git tag -a v0.2.0 -m "Configuração de sala, vitrine pública e modo espectador"
```

> Tag leve (`git tag v0.2.0`) é só um ponteiro: não guarda autor, data nem
> mensagem, e `git describe` a ignora por padrão. A anotada é um objeto de
> verdade no repositório, e é ela que responde "quem cortou este release,
> quando e por quê" seis meses depois.

## 4. Receitas

### Uma feature, do início ao fim

```bash
git checkout develop && git pull
git checkout -b feature/modo-espectador

# … trabalho, com commits pequenos e descritivos …

pnpm verificar                    # a bateria completa — ver DOC-092
git push -u origin feature/modo-espectador
# abra o PR contra `develop`
```

Depois do PR aprovado e verde:

```bash
git checkout develop && git pull
git merge --no-ff feature/modo-espectador
git push
git branch -d feature/modo-espectador
git push origin --delete feature/modo-espectador
```

> **`--no-ff` é obrigatório.** Sem ele, uma feature de seis commits vira seis
> commits soltos na `develop` e a fronteira da feature desaparece do histórico
> — junto com a possibilidade de reverter a feature inteira com um comando.

### Cortar um release

```bash
git checkout develop && git pull
git checkout -b release/v0.2.0

# ajuste a versão nos package.json, atualize o CHANGELOG,
# corrija o que a estabilização revelar

git checkout main && git merge --no-ff release/v0.2.0
git tag -a v0.2.0 -m "Configuração de sala, vitrine pública e modo espectador"
git push origin main --follow-tags

# de volta para a develop, senão as correções da estabilização se perdem
git checkout develop && git merge --no-ff release/v0.2.0 && git push
git branch -d release/v0.2.0
```

### Um hotfix

```bash
git checkout main && git pull
git checkout -b hotfix/v0.2.1

# a correção, mínima e focada — mais o teste que a prova

git checkout main && git merge --no-ff hotfix/v0.2.1
git tag -a v0.2.1 -m "Corrige X"
git push origin main --follow-tags

git checkout develop && git merge --no-ff hotfix/v0.2.1 && git push
git branch -d hotfix/v0.2.1
```

## 5. Mensagem de commit

[Conventional Commits](https://www.conventionalcommits.org/pt-br/), com o corpo
em português.

```
tipo(escopo): o que mudou, no imperativo e em minúsculas

O PORQUÊ. Que defeito isto corrige, ou que alternativa foi descartada e por
quê. Quem lê um commit seis meses depois já consegue ver o QUE mudou no diff;
o que o diff não conta é a decisão.

Quebre em 72 colunas.
```

Tipos: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`,
`chore`.

### O que NÃO entra numa mensagem de commit

- **Atribuição a ferramenta.** Sem `Co-Authored-By` de assistente, sem
  "Generated with", sem `Claude-Session`, sem emoji de robô. O autor do commit
  é quem responde pelo código — e responder por ele é o que a autoria
  significa. Uma ferramenta não responde por nada.
- **Ruído de processo.** "wip", "ajustes", "correções": se o commit não merece
  uma frase que diga o que ele faz, ele provavelmente deveria estar junto do
  anterior.

#### Esta regra é imposta por máquina, e o motivo é histórico

Ela já era escrita aqui, nestas mesmas palavras. O histórico inteiro já foi
limpo de `Co-Authored-By` uma vez — **28 commits reescritos**, com force-push
em `main`.

E voltou. Uma instrução de ferramenta sobrescreveu a regra do projeto no meio
de uma sessão, quatro commits saíram assinados e chegaram ao remoto antes de
alguém notar. A limpeza custou uma segunda reescrita de histórico.

Essa é a diferença entre uma regra e uma trava. A regra depende de quem
escreve o commit lembrar dela **e ter permissão de segui-la** — e o segundo
não estava sob controle de ninguém aqui. A trava não depende de nenhum dos
dois. Um documento que já foi desobedecido uma vez não fica mais persuasivo na
segunda.

`tools/sem-atribuicao-de-ia.mjs` roda em três lugares, e os três existem por
um motivo diferente:

| Onde                | Quando                        | Por que não basta o anterior                                |
| ------------------- | ----------------------------- | ----------------------------------------------------------- |
| `.husky/commit-msg` | ao escrever a mensagem        | —                                                           |
| `.husky/pre-push`   | em todos os commits que sobem | `git commit --no-verify` pula o anterior                    |
| CI                  | no push e no PR               | os hooks são locais, e `--no-verify` também pula o pre-push |

O que importa é o terceiro: os dois primeiros são conveniência — falham cedo e
barato. O do CI é o que garante que a coisa **não chega ao remoto**, que é
onde limpar deixa de ser um `--amend` e vira reescrita de histórico para todo
mundo que já puxou.

**Co-autoria entre pessoas continua valendo.** O filtro só recusa co-autor que
é ferramenta; barrar pair programming junto ensinaria a usar `--no-verify` por
hábito, e o hábito desliga a trava inteira.

### O estilo dos comentários no código segue a mesma regra

Comentário explica o **defeito que a linha corrige** ou a **alternativa que foi
descartada** — não o que o código faz. Cabeçalho de arquivo com o bloco
`─── TÍTULO ───`. Português, com acento.

## 6. Proteções da `main` e da `develop`

Configurar em _Settings → Branches_ no GitHub, para as duas:

- exigir PR antes do merge (sem push direto);
- exigir que o CI passe;
- exigir que a branch esteja atualizada com a base;
- proibir force-push e deleção.

> Sem a proteção de force-push, uma reescrita de histórico feita por engano na
> máquina de alguém apaga trabalho de todo mundo, e o `reflog` que salvaria
> está só na máquina de quem errou.

## 7. Reescrita de histórico

Vale em `feature/*` que ainda não foi compartilhada — `rebase -i` para limpar
commits antes de abrir o PR é bem-vindo.

**Nunca** em `main`, `develop` ou branch com PR aberto: quem já puxou fica com
um histórico divergente, e a reconciliação manual é onde trabalho se perde.

Se a reescrita for inevitável (segredo commitado, atribuição indevida), ela é
um evento coordenado: avise todo mundo, crie a branch de backup ANTES, e todos
refazem o clone depois.

## 8. Documentos irmãos

- **DOC-092** — [Política de Testes](politica_de_testes.md): o que roda antes
  de subir, e por quê cada passo existe.
- **DOC-093** — [Política de Documentação](politica_de_documentacao.md): o que
  precisa ser atualizado junto com o código.
