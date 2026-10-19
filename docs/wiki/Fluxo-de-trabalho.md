# Fluxo de trabalho

A regra canônica é o
[DOC-091 — Fluxo de Trabalho Git](https://github.com/Dracon-46/AetherTable/blob/main/docs/fluxo_de_trabalho_git.md).
Esta página resume.

## As branches

| Branch      | Vida       | Promessa                                       | Nasce de  | Volta para         |
| ----------- | ---------- | ---------------------------------------------- | --------- | ------------------ |
| `main`      | eterna     | só o que está em produção; todo commit tem tag | —         | —                  |
| `develop`   | eterna     | o próximo release, integrado e verde           | `main`    | —                  |
| `feature/*` | temporária | um assunto                                     | `develop` | `develop`          |
| `release/*` | temporária | estabilizar o que vai sair                     | `develop` | `main` e `develop` |
| `hotfix/*`  | temporária | corrigir produção agora                        | `main`    | `main` e `develop` |

Branch temporária é apagada (local e remota) depois do merge.

## Uma feature, do início ao fim

```bash
git checkout develop && git pull
git checkout -b feature/modo-espectador

# commits pequenos, mensagem em português dizendo o PORQUÊ

pnpm verificar
git push -u origin feature/modo-espectador
# PR contra a develop; o template pede o checklist
```

Merge sempre com **`--no-ff`**: sem ele, a fronteira da feature some do
histórico, e com ela a possibilidade de reverter a feature inteira com um
comando.

## Mensagens de commit

```
tipo(escopo): o que mudou, em português

O porquê: que defeito isto corrige, ou que alternativa foi descartada.
```

Tipos usados: `feat`, `fix`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`.

**Sem atribuição a ferramenta**: nada de `Co-Authored-By` de assistente,
"Generated with" ou emoji de robô. O autor do commit responde pelo código. Três
travas garantem isso: o hook `commit-msg`, o `pre-push` e o job `atribuicao` do
CI.

## Hooks locais (Husky)

| Hook         | O que roda                                                      |
| ------------ | --------------------------------------------------------------- |
| `pre-commit` | ESLint e Prettier só nos arquivos staged                        |
| `commit-msg` | recusa mensagem com atribuição a ferramenta                     |
| `pre-push`   | `pnpm verificar` (a bateria inteira) e a checagem de atribuição |

## Versão e release

[SemVer](https://semver.org/lang/pt-BR/): MAJOR quebra o que existia, MINOR traz
funcionalidade compatível, PATCH só corrige.

```bash
git checkout develop && git pull
git checkout -b release/v0.10.0
# versão nos package.json, CHANGELOG.md, correções de estabilização

git checkout main && git merge --no-ff release/v0.10.0
git tag -a v0.10.0 -m "v0.10.0 — o resumo do release"
git push origin main --follow-tags
git checkout develop && git merge --no-ff release/v0.10.0 && git push
```

Tag **anotada**, sempre. A mensagem da tag vira a nota do Release no GitHub
(workflow `release.yml`).

## Pull request

O template pede, entre outros:

- `pnpm verificar` passando;
- teste para o comportamento novo, ou o teste que falhava antes da correção;
- E2E multijogador rodado, se o PR mexeu em render, geometria ou conexão da mesa;
- documentos afetados atualizados **no mesmo PR**
  ([DOC-093](https://github.com/Dracon-46/AetherTable/blob/main/docs/politica_de_documentacao.md));
- variável de ambiente nova no `.env.example` **e** no `render.yaml`.
