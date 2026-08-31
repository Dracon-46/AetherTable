'use client';

/**
 * voice.tsx — ponte entre o LiveKit e o resto da interface.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * `ActionBar` e `LifePanel` chamavam `useLocalParticipant()` / `useParticipants()`
 * dentro de um `try/catch`, contando com a exceção para detectar "ainda não
 * estamos dentro do LiveKitRoom". Isso viola as regras dos hooks: quando o
 * `voiceToken` chega (assíncrono) a árvore passa a ter o provider, o hook para
 * de lançar, e o React vê um número diferente de hooks entre dois renders do
 * MESMO componente — "Rendered more hooks than during the previous render".
 * O resultado prático era a mesa inteira sumir no instante em que a voz
 * conectava.
 *
 * A solução é não deixar nenhum componente da mesa depender do contexto do
 * LiveKit. `VoiceBridge` é montado DENTRO do `LiveKitRoom` — portanto seus
 * hooks são sempre válidos — e espelha o que interessa num store comum.
 * Quem precisa da informação apenas lê o store.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { useLocalParticipant, useParticipants } from '@livekit/components-react';

interface VoiceState {
  /** Há uma sala de voz conectada nesta sessão? */
  available: boolean;
  micEnabled: boolean;
  /** `userId` (identity do LiveKit) de quem está falando agora. */
  speaking: string[];
  toggleMic: () => void;
  setVoice: (patch: Partial<Omit<VoiceState, 'setVoice' | 'reset'>>) => void;
  reset: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  available: false,
  micEnabled: false,
  speaking: [],
  toggleMic: () => {},
  setVoice: (patch) => set(patch),
  reset: () => set({ available: false, micEnabled: false, speaking: [], toggleMic: () => {} }),
}));

/** Só é renderizado dentro de `<LiveKitRoom>`. */
export function VoiceBridge() {
  const { isMicrophoneEnabled, localParticipant } = useLocalParticipant();
  const participants = useParticipants();

  const speakingKey = participants
    .filter((p) => p.isSpeaking)
    .map((p) => p.identity)
    .sort()
    .join(',');

  useEffect(() => {
    useVoiceStore.getState().setVoice({
      available: true,
      micEnabled: isMicrophoneEnabled,
      speaking: speakingKey ? speakingKey.split(',') : [],
      toggleMic: () => {
        void localParticipant?.setMicrophoneEnabled(!isMicrophoneEnabled);
      },
    });
  }, [isMicrophoneEnabled, localParticipant, speakingKey]);

  useEffect(() => () => useVoiceStore.getState().reset(), []);

  return null;
}
