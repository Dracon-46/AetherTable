# Política de segurança

O AetherTable é mantido pela **Falkyria**. Levamos a sério qualquer falha que
exponha conta, informação oculta da mesa (mão, grimório, cartas viradas) ou a
infraestrutura.

## Como relatar uma vulnerabilidade

**Não abra issue pública.** Uma issue é visível para todo mundo antes de existir
correção.

Use o relato privado do GitHub:
**[Security → Report a vulnerability](https://github.com/Dracon-46/AetherTable/security/advisories/new)**.

Inclua, se puder:

- o que a falha permite (ler a mão de outro jogador, entrar na conta de outra
  pessoa, derrubar uma sala…);
- os passos para reproduzir, com o serviço afetado (site, API, servidor de jogo);
- a versão ou o commit em que você observou o problema.

## O que esperar

| Etapa                         | Prazo                        |
| ----------------------------- | ---------------------------- |
| Confirmação de recebimento    | até 3 dias úteis             |
| Avaliação inicial e gravidade | até 7 dias úteis             |
| Correção de falha crítica     | o mais rápido possível       |
| Publicação do aviso           | junto com a versão corrigida |

Damos crédito a quem relatou no aviso publicado, se a pessoa quiser.

## Versões cobertas

Só a versão em produção, ou seja, a última tag `v*` da branch `main`. Versões
antigas não recebem correção à parte.

## Escopo

Dentro do escopo:

- `apps/backend-core` (API): autenticação, sessões, OAuth, decks, moderação;
- `apps/game-server` (servidor de jogo): passe de mesa, visibilidade de zonas
  ocultas, autorização de intenções, negação de serviço de uma sala;
- `apps/frontend` (site): XSS, roubo de sessão, redirecionamento aberto;
- os workflows em `.github/` e os arquivos de deploy (`render.yaml`, Dockerfiles).

Fora do escopo: ataques de engenharia social, negação de serviço volumétrica
contra a hospedagem (Render, Vercel, Neon) e falhas que dependem de acesso
físico ao dispositivo da vítima.

O modelo de ameaças completo está em
[`docs/plano_de_seguranca_e_ameacas_threat_model.md`](docs/plano_de_seguranca_e_ameacas_threat_model.md).
