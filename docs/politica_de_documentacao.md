# Política de Documentação

| Campo         | Valor             |
| ------------- | ----------------- |
| **ID**        | `DOC-093`         |
| **Vale para** | todo pull request |

## 1. A regra

> **Documento desatualizado é pior que documento ausente.**

Um documento ausente manda a pessoa ler o código. Um desatualizado a faz
confiar numa coisa que não é verdade — e ela só descobre depois de agir sobre
a informação errada. É o mesmo raciocínio de `MulliganModal` anunciar "London
Mulligan" numa mesa que combinou outra regra, ou de um seletor de nível de
poder que parece validar deck e não valida.

Daí a segunda regra, que é operacional:

> **A atualização do documento vai no MESMO pull request que muda o
> comportamento.** Não na próxima sprint, não numa tarefa de follow-up.

Deixar para depois não é adiar o trabalho — é decidir que o documento vai
mentir por um tempo indeterminado.

## 2. Mudou isto → atualize aquilo

| Mudança                                          | Documento                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| Intenção nova, removida ou com payload diferente | `especificacao_websocket_e_eventos.md` + `pnpm docs:estado`                  |
| Campo no `RoomState`, `Player` ou `Card`         | `especificacao_do_motor_sandbox.md` + `pnpm schema:sync`                     |
| Rota da API                                      | `especificacao_da_api_backend.md`                                            |
| Schema do Prisma                                 | `modelo_de_dados.md` + migração                                              |
| Formato ou regra de legalidade                   | `catalogo_de_formatos_e_variantes.md`                                        |
| Ação de mesa                                     | `catalogo_de_acoes_da_mesa.md`                                               |
| Variável de ambiente                             | `.env.example` + `guia_de_configuracao_e_desenvolvimento.md` + `render.yaml` |
| Decisão de arquitetura                           | ADR novo em `documento_de_arquitetura.md`                                    |
| Superfície de ataque, autenticação, autorização  | `plano_de_seguranca_e_ameacas_threat_model.md`                               |
| Tela ou componente novo                          | `especificacao_tecnica_do_frontend_ui_ux.md`                                 |
| Passo de build, deploy ou CI                     | `devops_e_infraestrutura.md`                                                 |
| Processo de trabalho                             | `fluxo_de_trabalho_git.md` / `politica_de_testes.md` / este                  |

Não achou a linha? A mudança provavelmente merece uma seção nova — ou é
pequena o bastante para viver só no comentário do código. As duas respostas
são válidas; o que não é válido é não olhar.

## 3. Documentos gerados NÃO se edita à mão

| Arquivo                           | Gerado por         |
| --------------------------------- | ------------------ |
| `docs/estado_de_implementacao.md` | `pnpm docs:estado` |
| `apps/frontend/src/net/schema/*`  | `pnpm schema:sync` |

Os dois têm guarda no CI (`schema:check` e o `mirror.spec.ts`). Editar à mão
funciona até a próxima geração, que desfaz tudo em silêncio.

## 4. O comentário no código é documentação, e tem regra própria

O código deste repositório carrega uma quantidade incomum de comentário, e ela
é deliberada. A regra é uma:

> **Comentário explica o DEFEITO que a linha corrige ou a ALTERNATIVA que foi
> descartada — nunca o que o código faz.**

O que o código faz está no código. O que ele não conta é por que a solução
óbvia não serve. Exemplos reais deste repositório:

- **`window.location.href` no `handleConnect`** tem um bloco em caixa alta
  explicando que trocá-lo por `router.push` quebra a entrada na mesa por
  completo — o `seatToken` é de uso único e o StrictMode invoca o efeito duas
  vezes. Sem o comentário, a "otimização" seria refeita.
- **A ordem dos campos no `RoomState`** tem um aviso de que campo novo vai no
  fim, porque `@colyseus/schema` serializa por índice.
- **`Espectador.ts`** lista os quatro lugares que quebrariam se espectador
  fosse um `Player` com uma flag.

Formato: português com acento, cabeçalho de arquivo com o bloco
`─── TÍTULO ───`.

### E o comentário também desatualiza

Mudou a linha que o comentário explica? O comentário faz parte do diff. Um
comentário que descreve um defeito já corrigido de outro jeito é a forma mais
convincente de informação errada que existe — ele _parece_ memória
institucional.

## 5. Quando um documento vira um documento novo

Crie um arquivo próprio quando o assunto tiver **dono e ciclo de vida
distintos** do documento que o hospedaria. Foi o critério de
`shared-types/sala.ts` não crescer dentro de `room.ts`: um é o contrato do
estado em tempo real, o outro é o contrato da configuração, e quem só quer
montar um formulário não precisa arrastar `ICard` e `IPlayer`.

O novo documento recebe:

- **um ID** `DOC-0XX` na tabela do cabeçalho, contínuo com os existentes;
- **uma seção "por que este documento existe"** — se ela for difícil de
  escrever, o documento provavelmente é uma seção de outro;
- **um link em `docs/readme.md`**, que é o índice. Documento fora do índice é
  documento que ninguém acha.

## 6. Checklist do pull request

- [ ] Os documentos da tabela da seção 2 estão atualizados.
- [ ] Os gerados foram regerados (`pnpm docs:estado`, `pnpm schema:sync`).
- [ ] Os comentários das linhas tocadas continuam verdadeiros.
- [ ] Documento novo tem ID e está no índice.
- [ ] Variável de ambiente nova está em `.env.example` **e** no `render.yaml`.

## 7. Documentos irmãos

- **DOC-091** — [Fluxo de Trabalho Git](fluxo_de_trabalho_git.md)
- **DOC-092** — [Política de Testes](politica_de_testes.md)
