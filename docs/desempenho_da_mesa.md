# DOC-095 — Desempenho e reconexão da mesa

> Por que a mesa ficava lenta e travava em partida longa, o que foi corrigido, e
> o que medir antes de mexer aqui de novo.

## 1. O relato

> "o jogo tá com bastante lags e demorando muito"
> "depois de uns 15 minutos jogando o jogo trava para mim e isso me impossibilita
> de fazer as coisas, cada partida geralmente leva 3/4 horas"

Duas queixas, **uma raiz provável**: degradação progressiva. Quinze minutos não é
um limite de nada no sistema — é quando a degradação passa de incômoda a
impeditiva.

### O que foi descartado primeiro

| Hipótese            | Por que não é                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Expiração do JWT    | `JWT_ACCESS_TTL` é **86400** (24 h) em `.env` e em `render.yaml`. Um token de 15 min existiu no `.env.example` e nunca foi lido. |
| Janela de reconexão | 90 **segundos**, e ela só entra em cena depois de o socket cair.                                                                 |
| Heartbeat           | `HEARTBEAT_MS` é 15 **segundos**, não minutos.                                                                                   |
| Limite de intenções | 30/s por cliente, e o excedente é descartado com aviso — não trava.                                                              |

## 2. As duas causas encontradas

### 2.1 Cópia do mapa de cartas por CAMPO alterado

`upsertCard` fazia `{ ...s.cards, [id]: {...} }`. Numa mesa de Commander com
quatro jogadores, `cards` tem em torno de **400 chaves**.

O servidor emite patch a 20 Hz (`PATCH_RATE_MS: 50`). Um patch carrega as
mudanças de várias cartas, e **cada campo alterado disparava o próprio callback
e a própria cópia**. Pior: cada cópia é uma identidade nova de `cards`, e
`GameBoard` assina o objeto inteiro (`useGameStore((s) => s.cards)`) — então
cada uma custava um render completo do tabuleiro e a reconciliação de todos os
nós do Konva.

Arrastar uma carta sozinho produz ~20 atualizações de posição por segundo. Com
quatro pessoas mexendo, dezenas de cópias de 400 chaves **por quadro**, todas
para mostrar o mesmo resultado final.

**Correção:** `net/lote.ts` acumula as mudanças e aplica **uma vez por quadro de
animação** (`aplicarLoteDeCartas`). N cópias viram uma; N renders viram um.

`requestAnimationFrame` e não temporizador porque o destino do dado é a tela:
aplicar mais de uma vez entre dois quadros é trabalho que ninguém vê, e o rAF
ainda para numa aba em segundo plano.

### 2.2 Cache de texturas sem teto

`canvas/textureCache.ts` era um `Map` que só crescia. `limparCache()` existia e
nunca era chamado durante a partida.

As cartas da mesa são pedidas na qualidade `normal`. Um bitmap `normal`
**decodificado** ocupa cerca de `750 × 1050 × 4` bytes — uns **3 MB de memória**,
independentemente do tamanho em disco.

Numa mesa de Commander são 400 cartas distintas, mais fichas, mais o que passou
por cemitério e exílio. Algumas centenas de entradas × 3 MB chega à casa do
**gigabyte** — e o sintoma disso não é um erro, é a aba ficar progressivamente
mais lenta e depois travar.

**Correção:** teto de **300 entradas** com descarte do menos usado recentemente.
`Map` preserva ordem de inserção, então reinserir uma chave a manda para o fim e
a primeira do iterador é sempre a mais fria.

> **O descarte NÃO cancela o download da imagem descartada.** Sair do cache não
> significa sair da tela: um nó do Konva pode estar segurando aquela instância, e
> zerar o `src` dela deixaria a carta em branco **para sempre** — nada reemite o
> pedido enquanto o nó não for reconstruído. Poupar uma imagem de banda não paga
> esse risco. Há um teste travando isso.

## 3. O que medir antes de mexer aqui

Nenhuma das duas correções foi medida com profiler numa partida de três horas —
elas vêm de leitura de código e de aritmética. São melhorias corretas
independentemente, mas **se a queixa voltar, meça antes de mudar mais**:

1. **Memória** — DevTools → Memory → _Heap snapshot_ no início e depois de 30
   min de jogo. Procure `HTMLImageElement` retido. Com o teto, o número de
   instâncias vivas tem de estabilizar em torno de 300.
2. **Renders** — React DevTools → Profiler, gravando durante um arraste.
   `GameBoard` deve renderizar **no máximo uma vez por quadro**, não uma vez por
   patch.
3. **Quadro** — DevTools → Performance durante um arraste com quatro jogadores.
   O que interessa é o tempo de _scripting_ por quadro, não o FPS médio.

### Suspeitos ainda não investigados

- `useRoomSync` **nunca remove os listeners** na limpeza (há um comentário
  explicando: `removeAllListeners()` quebrava o StrictMode). Numa sessão com
  várias entradas e saídas de mesa, as assinaturas podem acumular.
- `zoneOrder` e `players` usam o mesmo padrão de cópia de `upsertCard`. São
  mapas muito menores (28 e 4 chaves), então o custo é outra ordem de grandeza —
  mas eles disparam a cada movimento de carta.
- Nenhum nó do Konva usa `perfectDrawEnabled(false)` nem `listening(false)` onde
  poderia.

## 4. Reconexão — o F5 e a vaga reservada

Relato: _"se eu dou f5 ou recarrego a página eu saio da sala, tem que arrumar
isso, eu não consigo voltar também"_.

O servidor **sempre** esteve certo: `onLeave` com `consented === false` chama
`allowReconnection` e guarda o assento. Os dois defeitos eram do cliente:

1. A limpeza do efeito chamava `room.leave()` **sem argumento** — que no Colyseus
   é saída CONSENTIDA. O servidor remove o assento na hora. A recarga destruía o
   próprio assento antes de tentar voltar para ele.
2. Não havia `reconnect()` em lugar nenhum. O cliente reenviava o `seatToken` da
   query string, que é de **uso único** (`jtisUsados`, FR-20) e volta como
   `TOKEN_ALREADY_USED` para sempre.

**Correção:** `net/reconexao.ts` guarda o `reconnectionToken` no
`sessionStorage` (por aba, sobrevive ao F5), e a página tenta `reconnect()`
antes de `joinOrCreate`. A limpeza passou a usar `leave(false)`.

> A chave é **regravada depois de cada reconexão**: o `reconnectionToken` muda a
> cada conexão, e guardá-lo só na primeira entrada faria a segunda recarga usar
> uma chave queimada. Há um caso de e2e para duas recargas seguidas.

### A janela é de 10 minutos, e a vaga fica reservada

`RECONNECTION_WINDOW_S` era 90 segundos — cobre um F5 e nada mais. Numa partida
de três a quatro horas, um navegador trava, um wi-fi cai, um notebook hiberna.

Durante a janela **ninguém entra no lugar de quem caiu**: o jogador continua em
`state.players` com `connected: false`, e `haAssentoLivre` conta essa lista.

O custo é que uma mesa pública com alguém que abandonou de vez só libera o
assento após dez minutos. Quem **sai de propósito** não paga: saída consentida
(`INTENT_LEAVE` e o botão de sair) remove o assento na hora, e o anfitrião pode
expulsar.

## 5. Regra

**Qualquer mudança no caminho `patch → store → GameBoard` exige o e2e de mesa**
(`mesa-multijogador.spec.ts`), pelas razões de DOC-092 §2. Otimização que quebra
o render é pior que a lentidão que ela corrige.
