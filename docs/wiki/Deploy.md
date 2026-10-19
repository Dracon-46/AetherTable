# Deploy

O passo a passo completo está em
[`docs/deploy_gratuito.md`](https://github.com/Dracon-46/AetherTable/blob/main/docs/deploy_gratuito.md).
A infraestrutura-alvo (vários nós, staging, drenagem do servidor de jogo) está em
[`docs/devops_e_infraestrutura.md`](https://github.com/Dracon-46/AetherTable/blob/main/docs/devops_e_infraestrutura.md).

## Onde cada peça roda hoje

| Componente       | Serviço       | Como sobe                                                    |
| ---------------- | ------------- | ------------------------------------------------------------ |
| Site             | **Vercel**    | Root Directory `apps/frontend`; a Vercel detecta Next + pnpm |
| API              | **Render**    | imagem de `apps/backend-core/Dockerfile`, pelo `render.yaml` |
| Servidor de jogo | **Render**    | imagem de `apps/game-server/Dockerfile`, pelo `render.yaml`  |
| Banco            | **Neon**      | Postgres; a API aplica as migrações ao subir                 |
| Voz (opcional)   | LiveKit Cloud | sem as chaves, a voz fica desligada e a mesa segue           |

O Redis não é usado com um nó só (`USE_REDIS=false`). Ele passa a ser
obrigatório no dia em que o servidor de jogo tiver dois ou mais nós.

## Os dois segredos que precisam ser IGUAIS

| Segredo              | Se divergir entre API e servidor de jogo                                        |
| -------------------- | ------------------------------------------------------------------------------- |
| `JWT_SECRET`         | `Invalid seat token`: a mesa nunca abre                                         |
| `INTERNAL_API_TOKEN` | a mesa abre **vazia** e sem erro visível (o servidor toma 401 ao buscar o deck) |

## Plano gratuito: o que esperar

Os serviços do Render hibernam após ~15 min sem tráfego. A primeira conexão
depois disso espera ~50 s enquanto o container sobe, e o site avisa "acordando o
servidor". Durante uma partida isso não acontece: o tráfego mantém o serviço
acordado.

## Do merge ao ar

1. Release cortado conforme o [Fluxo de trabalho](Fluxo-de-trabalho):
   merge `--no-ff` na `main` e tag anotada.
2. O push da tag cria o Release no GitHub (`release.yml`).
3. Vercel e Render publicam a `main` sozinhos.
4. Conferir: `GET /api/v1/health` na API, `GET /health` no servidor de jogo, e
   uma partida de teste com duas contas.

## Variável nova

Vai no `.env.example` do app **e** no `render.yaml`, no mesmo PR. Variável que só
existe na máquina de quem a criou derruba o próximo deploy.
