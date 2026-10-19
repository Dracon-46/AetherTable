# Segurança

## Encontrou uma falha?

**Não abra issue pública.** Use o
[relato privado de vulnerabilidade](https://github.com/Dracon-46/AetherTable/security/advisories/new).
Prazos e escopo estão na
[política de segurança](https://github.com/Dracon-46/AetherTable/blob/main/SECURITY.md).

## O que protegemos, e como

O ativo mais sensível do produto é a **informação oculta da mesa**: a mão, o
grimório e a ordem dele, e as cartas viradas para baixo. Num jogo de cartas,
vazar isso é trapaça sem rastro.

| Ameaça                                   | Defesa                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ler a mão ou o grimório de outro jogador | cada cliente recebe só a sua **vista** do estado (`podeVer` + `StateView` do Colyseus)           |
| deduzir a ordem do grimório              | embaralhar só pelo CSPRNG (`services/rng.ts`, RN06); cartas ganham id novo a cada embaralhamento |
| entrar numa mesa sem convite             | passe de mesa: JWT de uso único, preso à sala, com audiência própria                             |
| usar a sessão da API como passe de mesa  | o servidor de jogo exige a audiência do passe; o access token não serve                          |
| ouvir a voz de uma mesa alheia           | o passe de voz é emitido pelo servidor de jogo, só para quem já entrou                           |
| roubar a conta                           | Argon2id, sessões revogáveis, OAuth com `state` assinado, cabeçalhos de segurança no site        |
| inundar uma sala                         | limites por intenção, tetos de fichas, contadores e setas, desconexão de quem abusa              |
| segredo vazado em log                    | cabeçalhos de autenticação censurados no log da API                                              |
| dependência vulnerável                   | Dependabot semanal, revisão de dependências no PR, CodeQL                                        |

## Para quem escreve código

- **Aleatoriedade só por `services/rng.ts`.** O ESLint barra `Math.random()` no
  servidor de jogo.
- **Handler de intenção é síncrono e sem I/O.** Um `await` ali segura a fila da
  sala inteira.
- **Toda intenção passa por zod**, com teto de tamanho em string e array.
- **Ação de anfitrião usa `exigirAnfitriao`**, nunca `seat === 0` à mão.
- **Segredo nunca entra no repositório.** `.env` está no `.gitignore`; o
  `.env.example` só tem marcadores.

O modelo de ameaças completo (STRIDE, por componente) está em
[`docs/plano_de_seguranca_e_ameacas_threat_model.md`](https://github.com/Dracon-46/AetherTable/blob/main/docs/plano_de_seguranca_e_ameacas_threat_model.md),
e a política de privacidade e LGPD em
[`docs/seguranca_e_privacidade.md`](https://github.com/Dracon-46/AetherTable/blob/main/docs/seguranca_e_privacidade.md).
