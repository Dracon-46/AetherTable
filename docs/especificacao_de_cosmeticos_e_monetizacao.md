# Especificação de Cosméticos e Monetização

| Campo                       | Valor                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-060`                                                                                                                                |
| **Versão**                  | 1.0                                                                                                                                      |
| **Status**                  | Estável                                                                                                                                  |
| **Última revisão**          | 2026-08-21                                                                                                                               |
| **Documentos relacionados** | [readme.md](readme.md) · [modelo_de_dados.md](modelo_de_dados.md) · [documento_de_visao_do_projeto.md](documento_de_visao_do_projeto.md) |

---

## 1. Visão Geral e Política

O **AetherTable** é 100% gratuito. A plataforma não cobra pelo acesso ao jogo, não vende cartas e não oferece vantagem mecânica paga. O sustento da infraestrutura provém do apoio da comunidade (via plataformas como Patreon/Apoia.se).

Em retribuição a esse apoio, a plataforma oferece **Cosméticos**, que são alterações puramente visuais na interface do jogador.

### 1.1 Decisão Arquitetural: Sistema Fechado (Sem Upload)

Para mitigar radicalmente os riscos de **direitos autorais (WotC)** e **conteúdo sensível (+18/ódio)**, os cosméticos de mesa (Playmats e Sleeves) operam sob um **sistema de seleção fechada**.
Os jogadores escolhem a partir de um catálogo pré-aprovado fornecido pela própria plataforma, gerido pelo Backoffice (ver `DOC-061`).

---

## 2. Tipos de Cosméticos

### 2.1 Protetores de Carta (Sleeves)

O fundo das cartas (quando estão _face-down_ na mesa ou no topo do grimório).

- **Restrição de IP:** O verso oficial das cartas de Magic é propriedade da WotC e **não** será usado por padrão, nem oferecido como sleeve.
- **Padrão:** O sleeve padrão (gratuito) é um fundo neutro texturizado com a logo do AetherTable.
- **Catálogo Premium:** Padrões abstratos, texturas de mana, fractais, arte sci-fi/fantasia licenciada livremente ou de autoria própria.
- **Renderização:** No Canvas, o sleeve é aplicado preenchendo as proporções `0.716` da carta. A borda da carta herda uma cor correspondente ao sleeve.

### 2.2 Playmats (Fundo da Mesa)

A imagem de fundo do _Battlefield_ individual do jogador. Os oponentes verão o playmat renderizado na região pertencente àquele jogador.

- **Opacidade:** O playmat recebe um overlay em CSS/Canvas de `rgba(0,0,0, 0.4)` para garantir que as cartas não se percam no contraste da imagem (seguindo a diretriz "Imersão Neutra" de `DOC-041`).
- **Dimensões:** As imagens devem ser _seamless_ (teláveis) ou cobrir uma proporção _ultrawide_, pesando no máximo 500KB (WEBP).

### 2.3 Avatares de Perfil

Usados no lobby, tela de perfis e painel de vida.

- **Origem:** O usuário pode fazer upload do próprio avatar (único caso de upload permitido, pois é restrito a uma pequena bolha 64x64) ou importar do OAuth (Google/Discord).
- **Moderação:** Qualquer usuário pode reportar um avatar inapropriado via denúncia.

### 2.4 Bordas Animadas de Perfil (Profile Borders)

Contornos que circundam o avatar do jogador e sua área de vida.

- **Formatos Suportados:**
  1. **CSS Puro:** Efeitos de _glow_, gradientes rotativos e neon. Altamente recomendados pela performance nula no CPU.
  2. **GIF e WebM:** Suportado, porém renderizados em loop atrás do avatar com restrição rigorosa de tamanho (max 200KB).

### 2.5 Títulos de Chat (Chat Titles)

Um pequeno _badge_ (insígnia) ao lado do nome do usuário nas mensagens do chat.

- **Exemplo:** `[Apoiador Mítico] Arthur` ou `[Patrono] Bia`.
- **Cores de Nome:** Apoiadores podem desbloquear cores exclusivas para seus nomes no chat.

---

## 3. Fluxo de Monetização e Entregas

A plataforma delega a cobrança para provedores externos (Patreon / Apoia.se).

### 3.1 Sincronização via Webhook

1. O usuário vincula sua conta do Patreon no painel do AetherTable (via OAuth).
2. O AetherTable recebe _webhooks_ do Patreon informando alterações no _Tier_ (nível de apoio) do usuário.
3. Se o usuário atingir o "Tier 1", o backend insere na tabela `UserCosmetics` os itens pertinentes àquele pacote.

### 3.2 Lógica de Inventário

Em vez de simplesmente atrelar "Tem Playmat" = `True`, o sistema utiliza um **Inventário**.

- O banco de dados cadastra os cosméticos (`CosmeticItem`).
- Quando um usuário adquire/desbloqueia um cosmético, ele é vinculado à sua conta (`UserCosmetics`).
- O jogador então _equipa_ um item do seu inventário (`UserPreference`).
- O painel administrativo pode dar cosméticos avulsos como prêmio (ex: participou do torneio da comunidade).

---

## 4. Checklist de Segurança e UX

- [ ] Nenhum sleeve ou playmat deve utilizar a propriedade intelectual da Hasbro/WotC.
- [ ] O carregamento de cosméticos na mesa (Canvas) é assíncrono. O jogo carrega as cartas **antes** de tentar renderizar os playmats e sleeves customizados, usando os padrões temporariamente se a rede estiver lenta.
- [ ] Usuários podem ativar a opção **"Desativar Cosméticos de Oponentes"** nas preferências locais, fazendo assim ele enxergar somente o fundo padrão. Isso respeita jogadores que têm dificuldades de contraste visual.
