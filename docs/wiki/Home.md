# AetherTable

Plataforma web _sandbox_ multiformato para **Magic: The Gathering**, com
Commander/EDH como formato principal. Produto da **Falkyria**.

> **Não existe motor de regras.** O sistema move peças, sincroniza o estado e
> esconde informação; quem aplica as regras é a mesa. É a decisão mais
> importante do projeto (RN01). Por causa dela, o cronômetro avisa mas nunca
> passa o turno, e o nível de poder da sala é uma etiqueta declarada, não um
> cálculo.

## Por onde começar

| Você quer…                                   | Leia                                         |
| -------------------------------------------- | -------------------------------------------- |
| rodar o projeto na sua máquina               | [Primeiros passos](Primeiros-passos)         |
| entender como as peças se encaixam           | [Arquitetura](Arquitetura)                   |
| abrir uma branch, um PR ou cortar um release | [Fluxo de trabalho](Fluxo-de-trabalho)       |
| saber o que o CI verifica e por quê          | [Qualidade e CI](Qualidade-e-CI)             |
| colocar no ar                                | [Deploy](Deploy)                             |
| relatar uma falha ou entender as defesas     | [Segurança](Seguranca)                       |
| achar o documento canônico de um assunto     | [Mapa da documentação](Mapa-da-documentacao) |
| decifrar um termo do projeto                 | [Glossário](Glossario)                       |

## Os três serviços

| Serviço        | Porta local | Tecnologia                  | Responsabilidade                                    |
| -------------- | ----------- | --------------------------- | --------------------------------------------------- |
| `frontend`     | 3030        | Next.js 15, React 19, Konva | desenha a mesa e envia **intenções**, nunca estado  |
| `backend-core` | 3333        | NestJS 11, Prisma, Postgres | contas, decks, cosméticos, passe de mesa, histórico |
| `game-server`  | 2567        | Colyseus 0.16               | o estado da partida, em RAM, autoritativo           |

## Sobre esta Wiki

A fonte destas páginas fica no próprio repositório, em
[`docs/wiki/`](https://github.com/Dracon-46/AetherTable/tree/main/docs/wiki), e
passa pela mesma revisão que o código. Um workflow copia a pasta para cá a cada
push na `main`. **Edição feita direto aqui é sobrescrita**: para mudar uma
página, abra um PR alterando o arquivo correspondente.

A documentação detalhada (especificações, ADRs, modelo de dados) continua em
[`docs/`](https://github.com/Dracon-46/AetherTable/tree/main/docs). Esta Wiki é a
porta de entrada para ela, não a substitui.
