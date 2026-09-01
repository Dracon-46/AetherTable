'use client';

/**
 * CenaDoDragao.tsx — o dragão que recebe login e registro.
 *
 * As duas telas tinham a mesma cena copiada: mesmo fundo, mesmo véu, mesma
 * lavagem laranja no hover. Copiada quer dizer que qualquer ajuste precisava
 * ser feito duas vezes — e a segunda seria esquecida.
 *
 * Aqui a cena é uma coisa só: o estado do bicho (`useDragao`) e o desenho
 * (`CenaDoDragao`). A página diz apenas QUANDO ele cospe.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FireCanvas, type FaseDoDragao } from './FireCanvas';

/** Quanto dura o sopro antes de a criatura assentar. */
const DURACAO_SOPRO = 1400;

export function useDragao() {
  const [fase, setFase] = useState<FaseDoDragao>('repouso');
  const soproRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Se o mouse continua sobre a cena, o sopro volta para carga, não para repouso. */
  const sobreACena = useRef(false);

  const cuspir = useCallback(() => {
    setFase('sopro');
    if (soproRef.current) clearTimeout(soproRef.current);
    soproRef.current = setTimeout(() => {
      setFase(sobreACena.current ? 'carga' : 'repouso');
    }, DURACAO_SOPRO);
  }, []);

  // Carga e relaxamento NUNCA interrompem um sopro em andamento: tirar o mouse
  // no meio do jato cortaria o fogo pela metade.
  const carregar = useCallback(() => {
    sobreACena.current = true;
    setFase((f) => (f === 'sopro' ? f : 'carga'));
  }, []);

  const relaxar = useCallback(() => {
    sobreACena.current = false;
    setFase((f) => (f === 'sopro' ? f : 'repouso'));
  }, []);

  useEffect(
    () => () => {
      if (soproRef.current) clearTimeout(soproRef.current);
    },
    [],
  );

  return { fase, carregar, relaxar, cuspir };
}

interface CenaDoDragaoProps {
  fase: FaseDoDragao;
  carregar: () => void;
  relaxar: () => void;
  cuspir: () => void;
}

export function CenaDoDragao({ fase, carregar, relaxar, cuspir }: CenaDoDragaoProps) {
  return (
    <>
      {/*
        A cena recebe o mouse — é o dragão que se aponta e se clica, não um
        botão. Fica em z-0, atrás do formulário: digitar e-mail nunca acorda o
        bicho por acidente.
      */}
      <div
        className="absolute inset-0 z-0"
        onMouseEnter={carregar}
        onMouseLeave={relaxar}
        onClick={cuspir}
        role="presentation"
      >
        <div
          className={`dragao-cena absolute inset-0 bg-cover bg-center bg-no-repeat ${
            fase === 'carga'
              ? 'dragao-inspira'
              : fase === 'sopro'
                ? 'dragao-cospe'
                : 'dragao-respira'
          }`}
          style={{ backgroundImage: 'url("/dragon_bg.png")' }}
        />
        {/*
          O véu que dá contraste ao formulário. Ele AFINA conforme a criatura
          acende: durante o sopro a caverna precisa clarear, senão o fogo
          acontece atrás de uma cortina cinza e não se vê nada.
        */}
        <div
          className={`absolute inset-0 backdrop-blur-[2px] transition-colors duration-500 ${
            fase === 'sopro'
              ? 'bg-table-deep/45'
              : fase === 'carga'
                ? 'bg-table-deep/60'
                : 'bg-table-deep/70'
          }`}
        />
      </div>

      {/* Brasas, inspiração e jato — ancorados na bocarra da arte. */}
      <FireCanvas fase={fase} />
    </>
  );
}
