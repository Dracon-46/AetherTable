# Especificação WebRTC (Voz / LiveKit)

| Campo | Valor |
|---|---|
| **ID** | `DOC-034` |
| **Versão** | 1.1 |
| **Status** | Estável |
| **Última revisão** | 2026-08-20 |
| **Documentos relacionados** | [readme.md](readme.md) · [documento_de_arquitetura.md](documento_de_arquitetura.md) · [especificacao_tecnica_do_frontend_ui_ux.md](especificacao_tecnica_do_frontend_ui_ux.md) · [devops_e_infraestrutura.md](devops_e_infraestrutura.md) |

---

## 1. Topologia da rede

Em vez de malha P2P — onde, em uma sala de 4 pessoas, cada jogador faz upload da própria voz para os
outros 3 — usamos arquitetura **SFU (Selective Forwarding Unit)** via LiveKit.

```
            MALHA P2P (descartada)              SFU (adotada)

              J1 ◄────► J2                    J1 ──┐     ┌── J2
               │ ╲    ╱ │                          │     │
               │  ╲  ╱  │                          ▼     ▼
               │   ╳     │                       ┌───────────┐
               │  ╱  ╲  │                        │  LiveKit  │
               │ ╱    ╲ │                        │    SFU    │
              J4 ◄────► J3                       └───────────┘
                                                    ▲     ▲
        Upload por jogador: 3 × 30 = 90 kbps         │     │
        Conexões ICE por jogador: 3            J4 ──┘     └── J3

                                          Upload por jogador: 1 × 30 = 30 kbps
                                          Conexões ICE por jogador: 1
```

O cliente envia o áudio **uma única vez** ao SFU, que o distribui aos outros três.

### 1.1 Por que isso importa no nosso contexto

Internet doméstica brasileira é fortemente assimétrica — planos de 300 Mbps de download costumam ter
30–50 Mbps de upload, e conexões mais modestas ficam abaixo de 10 Mbps. Malha P2P triplica o upload
justamente no recurso mais escasso, e ainda soma o custo de manter 3 conexões ICE simultâneas (mais
chance de falha de travessia de NAT).

| | Malha P2P | SFU |
|---|---|---|
| Upload por usuário | ~90 kbps (3 trilhas) | **~30 kbps (1 trilha)** |
| Download por usuário | ~90 kbps | ~90 kbps |
| Conexões ICE por usuário | 3 | **1** |
| Custo de banda no servidor | Zero | **Alto** — principal item da fatura |
| Escala para 5–6 jogadores | Degrada rápido | Linear |
| Ponto único de falha | Não | Sim (mitigado — §6) |

Decisão registrada em `ADR-005`.

---

## 2. Fluxo de conexão (handshake)

```
1. Cliente entra na sala do Colyseus (WSS) e é validado
                     │
2. Backend Core gera JWT do LiveKit                      ← FR-08, FR-20
   claims: { room: roomId, identity: userId,
             name: displayName,
             video: { canPublish: false },
             audio: { canPublish: true, canSubscribe: true } }
   TTL: 60 s para uso, sessão longa após conectado
                     │
3. Frontend: room.connect(livekitUrl, jwt)
                     │
4. LiveKit valida o JWT e admite o participante
                     │
5. Frontend publica a trilha local de áudio
                     │
6. Frontend assina as trilhas dos demais participantes
                     │
7. UI vincula cada trilha ao painel do jogador correspondente
```

### 2.1 O JWT do LiveKit

Emitido pelo **Backend Core** (nunca pelo frontend — a chave secreta do LiveKit não pode sair do
servidor).

| Claim | Valor | Motivo |
|---|---|---|
| `room` | `roomId` da partida | Impede entrar na sala de voz de outra partida |
| `identity` | `userId` persistente | Vincula a trilha ao jogador certo |
| `name` | `displayName` | Rótulo na UI |
| `canPublish` (áudio) | `true` | Falar |
| `canPublishVideo` | **`false`** | Vídeo está fora de escopo (`RFW03`) |
| `canPublishData` | `false` | Dados vão pelo Colyseus, não pelo LiveKit |
| `canSubscribe` | `true` | Ouvir |
| `exp` | 60 s para uso inicial | Token vazado tem janela mínima |

**Chave crítica de segurança:** o `roomId` no token é o que impede um jogador de entrar na sala de voz
de uma partida alheia. Sem esse vínculo, bastaria trocar um parâmetro no cliente.

### 2.2 Correlação entre identidade de voz e de jogo

O `identity` do LiveKit é o `userId` persistente; o `Player.id` do Colyseus é o `sessionId` da conexão.
São diferentes de propósito (a sessão muda a cada reconexão, o usuário não). O frontend mantém o mapa
`userId → sessionId` para saber em qual painel desenhar a aura de "falando".

---

## 3. Configuração de mídia

| Parâmetro | Valor | Justificativa |
|---|---|---|
| Codec | **Opus** | Padrão WebRTC, excelente para voz em baixo bitrate |
| Canais | Mono | Voz não se beneficia de estéreo; metade da banda |
| Bitrate | 24–32 kbps (padrão), até 64 kbps em sala de apoiador | Suficiente para fala inteligível |
| Taxa de amostragem | 48 kHz | Padrão do Opus |
| DTX (*Discontinuous Transmission*) | **Habilitado** | Para de transmitir no silêncio — economia real, já que a maior parte do tempo cada pessoa está calada |
| Supressão de ruído | Habilitada (cliente) | `noiseSuppression: true` |
| Cancelamento de eco | Habilitado (cliente) | `echoCancellation: true` |
| AGC | Habilitado (cliente) | `autoGainControl: true` |
| Transporte | UDP/SRTP; TURN sobre TCP/443 como *fallback* | Rede corporativa costuma bloquear UDP |

```ts
// frontend/src/voice/connect.ts
import { Room, RoomEvent, Track } from 'livekit-client';

export async function connectVoice(url: string, token: string) {
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: {
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1,
    },
    publishDefaults: { dtx: true, audioPreset: { maxBitrate: 32_000 } },
  });

  await room.connect(url, token);
  await room.localParticipant.setMicrophoneEnabled(true);
  return room;
}
```

---

## 4. Funcionalidades implementadas via SDK

### 4.1 Mute e volume

| Ação | Implementação | Escopo |
|---|---|---|
| **Mutar o próprio microfone** | `localParticipant.setMicrophoneEnabled(false)` — para de **publicar** | Todos deixam de ouvir |
| **Mute local de um oponente** | `remoteParticipant.setVolume(0)` | Só para mim |
| **Volume individual** | `remoteParticipant.setVolume(0..1)` | Só para mim |
| **Mutar todos** | Aplica volume 0 em todos os remotos | Só para mim |

**Distinção que a UI precisa deixar clara:** "mutar meu microfone" impede os outros de me ouvirem;
"mutar o Jogador 2" só afeta o que **eu** ouço. Ícones e textos diferentes.

O estado de volume/mute local vive no `audioStore` (Zustand) e é persistido em `UserPreference` quando
o usuário quiser que seja permanente.

### 4.2 Voice Activity Detection (VAD)

O SDK do LiveKit detecta nativamente quem está falando.

```ts
room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
  const ids = new Set(speakers.map(s => s.identity));
  useAudioStore.getState().setSpeaking(ids);   // dispara a aura na UI
});
```

O frontend intercepta e desenha uma **aura dourada** no avatar/painel de vida do falante — feedback
essencial numa mesa de 4 pessoas, onde saber quem está falando não é óbvio.

Parâmetros: limiar padrão do LiveKit, com *hold* de ~400 ms para a aura não piscar entre sílabas.

### 4.3 Push-to-Talk (PTT)

Alternativa ao VAD, escolhida em preferências (`voice_mode` em `DOC-023` §3.6):

```ts
// tecla pressionada → publica; solta → para de publicar
window.addEventListener('keydown', e => {
  if (e.code === pttKey && !e.repeat) room.localParticipant.setMicrophoneEnabled(true);
});
window.addEventListener('keyup', e => {
  if (e.code === pttKey) room.localParticipant.setMicrophoneEnabled(false);
});
```

PTT é a opção recomendada para quem tem ambiente ruidoso ou teclado mecânico alto.

### 4.4 Seleção de dispositivo

O painel de áudio lista microfones e saídas via `Room.getLocalDevices()` e permite trocar em tempo de
execução com `switchActiveDevice()`. Necessário porque headsets USB aparecem e desaparecem.

---

## 5. Integração com a UI

| Elemento | Comportamento |
|---|---|
| **Painel de vida do jogador** | Aura dourada quando `isSpeaking`; ícone de microfone cortado quando *muted* |
| **Barra inferior** | Botão de microfone próprio (estado on/off/PTT), indicador de qualidade de conexão |
| **Clique no avatar** | Abre controle de volume individual e *mute* local |
| **Indicador de qualidade** | Verde/amarelo/vermelho a partir de `ConnectionQuality` do SDK |
| **Estado de voz separado do de jogo** | Voz desconectada mostra aviso próprio, sem sugerir que a partida caiu |

Detalhes visuais em [guia_de_ui_e_design_system.md](guia_de_ui_e_design_system.md).

---

## 6. Modos de falha

| Cenário | Impacto | Comportamento |
|---|---|---|
| **Permissão de microfone negada** | Não fala | Entra como ouvinte; UI mostra como habilitar depois (`CDU07` E1) |
| **Sem microfone no dispositivo** | Não fala | Idem, com mensagem específica |
| **UDP bloqueado (rede corporativa)** | Latência maior | *Fallback* automático para TURN/TCP 443; UI indica "qualidade reduzida" |
| **LiveKit indisponível na entrada** | Sem voz | **A mesa funciona normalmente**; banner "voz indisponível" com botão de tentar novamente |
| **LiveKit cai durante a partida** | Voz cai | O WS da mesa **não** é afetado; SDK reconecta automaticamente; 3 tentativas com *backoff* |
| **Token expirado** | Não conecta | Frontend pede novo token ao Backend Core e repete |
| **Rede do jogador oscilando** | Áudio picado | `adaptiveStream` reduz qualidade antes de derrubar |
| **Eco / microfonia** | Incômodo para todos | Cancelamento de eco ativo; UI sugere usar fones |

**Invariante de projeto:** **falha de voz nunca degrada a partida.** São canais independentes
(`DOC-021` §1). Um jogador sem voz continua jogando; o grupo pode recorrer a voz externa sem perder a
mesa.

---

## 7. Custo e escala

O áudio é o **maior item variável** da fatura de infraestrutura (`DOC-001` §5.3).

### 7.1 Estimativa de banda no servidor

Para uma sala de 4 jogadores, com DTX e considerando ~35 % de tempo com alguém falando:

| Fluxo | Cálculo | Total |
|---|---|---|
| Entrada no SFU | 4 × 30 kbps × 0,35 | ~42 kbps |
| Saída do SFU | 4 × 3 × 30 kbps × 0,35 | ~126 kbps |
| **Total por sala** | — | **~170 kbps** ≈ 21 KB/s |
| Por hora de sala | 21 KB/s × 3.600 | ~75 MB/h |
| 100 salas simultâneas | — | ~17 Mbps, ~7,5 GB/h |

### 7.2 Estratégia de contenção

| Gatilho | Ação |
|---|---|
| Custo em crescimento | Reduzir bitrate padrão de 32 para 24 kbps |
| Custo alto persistente | Limitar bitrate elevado a salas de apoiador |
| Fatura > ~US$ 300/mês | Avaliar **LiveKit self-hosted** em VPS com banda generosa |
| Pico inesperado | Teto de salas com voz simultânea; salas excedentes entram sem voz, com aviso |

**Nunca** cortar a partida por causa de voz. Degradar áudio é aceitável; negar a mesa não é (`RN04`).

---

## 8. Privacidade

| Item | Política |
|---|---|
| **Gravação de áudio** | **Nunca.** O LiveKit tem recurso de gravação; ele fica **desabilitado** e sem permissão nos tokens |
| Transcrição | Não existe |
| Retenção | Zero — o áudio é efêmero, apenas encaminhado |
| Metadados | Apenas eventos de conexão para métrica agregada (`voice_joined`, `voice_failed`) |
| Consentimento | O navegador exige permissão explícita de microfone |
| Indicação visual | O usuário sempre vê se o próprio microfone está ativo — nunca escuta oculta |

Consistente com `RN11` e [seguranca_e_privacidade.md](seguranca_e_privacidade.md).

---

## 9. Métricas

| Métrica | Origem | Uso |
|---|---|---|
| `voice_participants_active` | LiveKit | Adoção da voz |
| `voice_join_success_rate` | Cliente | Confiabilidade (`RF11`) |
| `voice_turn_fallback_rate` | LiveKit | Quantos precisam de TURN (custo maior) |
| `voice_connection_quality` | SDK | Distribuição verde/amarelo/vermelho |
| `voice_bandwidth_bytes` | LiveKit | Projeção de custo |
| `voice_reconnects_total` | Cliente | Estabilidade |

---

## 10. Checklist de implementação

- [ ] JWT do LiveKit emitido **somente** pelo Backend Core, com `room` vinculado ao `roomId`.
- [ ] `canPublishVideo: false` e `canPublishData: false` em todos os tokens.
- [ ] Gravação desabilitada e sem permissão no token.
- [ ] Opus mono, 24–32 kbps, DTX habilitado.
- [ ] Supressão de ruído, cancelamento de eco e AGC ativos no cliente.
- [ ] Mapa `userId → sessionId` para vincular voz ao painel de jogo.
- [ ] Aura de `ActiveSpeakersChanged` com *hold* de ~400 ms.
- [ ] Mute de publicação **e** mute local, com UI distinguível.
- [ ] Volume individual persistido no `audioStore`.
- [ ] Modo PTT com tecla configurável.
- [ ] Seleção de dispositivo de entrada e saída.
- [ ] *Fallback* TURN/TCP 443 testado em rede sem UDP.
- [ ] Falha de voz **não** derruba nem bloqueia a mesa.
- [ ] Métricas da §9 instrumentadas.
