/**
 * voice.spec.tsx — o microfone que não liga precisa avisar.
 *
 * Com a permissão negada, `setMicrophoneEnabled` rejeitava e a promessa era
 * descartada: o botão do microfone parecia só não funcionar.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { VoiceBridge, mensagemDoMicrofone, useVoiceStore } from './voice';
import { useToast } from '../components/Toast';
import { MediaDeviceFailure } from 'livekit-client';

// O livekit-client real precisa de `TextEncoder`, que o jsdom não tem. Daqui só
// interessa a classificação da falha, que segue a do pacote: `NotAllowedError`
// é permissão negada.
jest.mock('livekit-client', () => ({
  MediaDeviceFailure: {
    PermissionDenied: 'PermissionDenied',
    NotFound: 'NotFound',
    DeviceInUse: 'DeviceInUse',
    Other: 'Other',
    getFailure: (erro: { name?: string }) =>
      erro.name === 'NotAllowedError' ? 'PermissionDenied' : 'Other',
  },
}));

const setMicrophoneEnabled = jest.fn();

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

jest.mock('@livekit/components-react', () => ({
  useLocalParticipant: () => ({
    isMicrophoneEnabled: false,
    localParticipant: { setMicrophoneEnabled },
  }),
  useParticipants: () => [],
}));

beforeEach(() => {
  setMicrophoneEnabled.mockReset();
  useToast.setState({ itens: [] });
});

describe('VoiceBridge → ligar o microfone', () => {
  it('permissão negada vira um aviso na tela', async () => {
    setMicrophoneEnabled.mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError'),
    );
    render(<VoiceBridge />);

    useVoiceStore.getState().toggleMic();

    await waitFor(() =>
      expect(useToast.getState().itens).toEqual([
        expect.objectContaining({
          tipo: 'erro',
          texto: mensagemDoMicrofone(MediaDeviceFailure.PermissionDenied),
        }),
      ]),
    );
  });

  it('ligar com sucesso não avisa nada', async () => {
    setMicrophoneEnabled.mockResolvedValue(undefined);
    render(<VoiceBridge />);

    useVoiceStore.getState().toggleMic();
    await waitFor(() => expect(setMicrophoneEnabled).toHaveBeenCalledWith(true));

    expect(useToast.getState().itens).toEqual([]);
  });
});
