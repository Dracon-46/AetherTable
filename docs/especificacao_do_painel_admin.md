# Especificação do Painel Administrativo (Backoffice)

| Campo                       | Valor                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-061`                                                                                                                                                        |
| **Versão**                  | 1.0                                                                                                                                                              |
| **Status**                  | Estável                                                                                                                                                          |
| **Última revisão**          | 2026-08-21                                                                                                                                                       |
| **Documentos relacionados** | [readme.md](readme.md) · [modelo_de_dados.md](modelo_de_dados.md) · [especificacao_de_cosmeticos_e_monetizacao.md](especificacao_de_cosmeticos_e_monetizacao.md) |

---

## 1. Visão Geral e Controle de Acesso

O Painel Administrativo (Backoffice) é uma área protegida (ex: rota `/admin` no Next.js) que centraliza todas as operações críticas de gestão da plataforma, que não devem ser expostas aos jogadores comuns.

O acesso é rigidamente controlado pela coluna `role` da tabela `User`:

- **`ADMIN`:** Acesso irrestrito. Pode criar/editar cosméticos, forçar atualizações de banco de dados, ver métricas gerais e atribuir cargos a outros usuários.
- **`MOD` (Moderador):** Acesso limitado à resolução de denúncias (Reports), bloqueios de contas nocivas e visualização de logs. Não tem acesso a operações financeiras ou arquiteturais.

---

## 2. Gestão de Usuários (Users CRUD)

Permite visualizar e interagir com o cadastro dos jogadores.

| Funcionalidade                  | Papel Mínimo | Descrição                                                                                       |
| ------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| **Busca de Usuários**           | `MOD`        | Buscar por email, username ou ID para investigar contas problemáticas.                          |
| **Suspensão Temporária**        | `MOD`        | Suspender conta por X dias (impede login e invalida JWT).                                       |
| **Banimento (Soft Delete)**     | `MOD`        | Aciona o fluxo de expurgo (marca `deleted_at = now()`), inativando imediatamente.               |
| **Gerenciamento de Inventário** | `ADMIN`      | Dar ou retirar manualmente um cosmético do inventário de um jogador (ex: prêmio de campeonato). |
| **Promover Usuário**            | `ADMIN`      | Alterar o `role` de um usuário para `MOD` ou `ADMIN`.                                           |

---

## 3. Gestão de Cosméticos (Cosmetics CRUD)

O sistema de cosméticos (`DOC-060`) é gerido por aqui, sem necessidade de editar o código ou o banco diretamente.

### 3.1 Playmats e Sleeves (Cadastros)

- A interface permite que o Administrador preencha o formulário para lançar novos _Playmats_ e _Sleeves_ pré-definidos no sistema.
- Campos exigidos: Nome Interno, Categoria (Playmat ou Sleeve), URL da Imagem (upload via bucket S3/Cloudflare R2), Tier mínimo (Qual o nível de apoiador mínimo para equipá-lo).

### 3.2 Bordas e Títulos

- Permite o cadastro de nomes para títulos no chat (ex: `Apoiador Vitalício`) e URLs/Classes CSS para bordas animadas.
- O catálogo gerado aqui ficará visível aos usuários no Lobby, em suas páginas de Preferências.

---

## 4. Central de Moderação e Reports

Todas as denúncias feitas dentro da partida (ex: conduta anti-jogo, discurso de ódio) caem aqui.

| Funcionalidade                  | Descrição                                                                                                                                                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fila de Denúncias**           | Lista de reports com status `OPEN` ou `REVIEWING`.                                                                                                                                                                                        |
| **Histórico de Logs (Isolado)** | A denúncia captura um "snapshot" das últimas linhas de log de ação e do chat para que o moderador possa analisar as evidências. Áudio não é gravado, então ofensas verbais dependem de denúncias múltiplas para gerar padrão de bloqueio. |
| **Resolução**                   | Moderador pode encerrar com status `RESOLVED` (punição aplicada) ou `DISMISSED` (denúncia inválida).                                                                                                                                      |

---

## 5. Ferramentas do Sistema (Operações)

Ações perigosas que afetam o funcionamento global da plataforma.

| Funcionalidade               | Descrição                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Forçar Cache da Scryfall** | Aciona manualmente o _Worker_ que faz o bulk download de todos os dados do MTG na Scryfall (útil após o fim dos spoilers de uma nova coleção).   |
| **Monitor do Colyseus**      | Um Iframe embutindo a UI nativa de `@colyseus/monitor`, onde o Admin pode ver e encerrar salas problemáticas (partidas "fantasmas").             |
| **Kill Switch de Voz**       | Um botão de emergência que desabilita a flag do `LiveKit` para todo mundo, caso o faturamento do SFU atinja um teto alarmante ou haja um ataque. |

---

## 6. Checklist de Segurança

- [ ] Proteção de rota via guardião no Backend e SSR (Server Side Rendering) no Next.js (Nunca retornar o HTML do admin se o JWT não constar `role == ADMIN|MOD`).
- [ ] Todo Endpoint do módulo Admin gera um rastro de **Log de Auditoria** inalterável ("Admin X deletou usuário Y em [data]").
- [ ] Moderadores não têm acesso às páginas de "Ferramentas do Sistema" nem "Gestão de Cosméticos".
