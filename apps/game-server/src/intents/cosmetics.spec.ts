/**
 * cosmetics.spec.ts — o catálogo fechado só é fechado se o servidor recusar o
 * que está fora dele.
 *
 * DOC-060 §1.1 escolhe seleção fechada em vez de upload por dois motivos que
 * nenhuma moderação reativa cobre: propriedade intelectual da WotC e conteúdo
 * sensível numa mesa que pode ter menores. Se o campo aceitasse uma string
 * livre, "sleeveId" viraria "sleeveUrl" na prática — e o sistema fechado seria
 * só uma convenção que o primeiro cliente adulterado ignora.
 */

import { SetCosmeticsIntent } from './schemas';
import { SLEEVES, PLAYMATS, PROFILE_BORDERS, CHAT_TITLES, PETS } from '@aethertable/shared-types';

describe('INTENT_SET_COSMETICS — catálogo fechado', () => {
  it('aceita todo item do catálogo', () => {
    for (const s of SLEEVES)
      expect(SetCosmeticsIntent.safeParse({ sleeveId: s.id }).success).toBe(true);
    for (const p of PLAYMATS)
      expect(SetCosmeticsIntent.safeParse({ playmatId: p.id }).success).toBe(true);
    for (const b of PROFILE_BORDERS)
      expect(SetCosmeticsIntent.safeParse({ borderId: b.id }).success).toBe(true);
    for (const t of CHAT_TITLES)
      expect(SetCosmeticsIntent.safeParse({ titleId: t.id }).success).toBe(true);
    for (const p of PETS) expect(SetCosmeticsIntent.safeParse({ petId: p.id }).success).toBe(true);
  });

  it('RECUSA uma URL — upload disfarçado é o que o sistema fechado impede', () => {
    for (const url of [
      'https://exemplo.com/verso-oficial.jpg',
      'http://localhost/arte.png',
      'data:image/png;base64,AAAA',
      '//cdn.terceiros.net/playmat.webp',
    ]) {
      expect(SetCosmeticsIntent.safeParse({ sleeveId: url }).success).toBe(false);
      expect(SetCosmeticsIntent.safeParse({ playmatId: url }).success).toBe(false);
    }
  });

  it('recusa id que não existe no catálogo', () => {
    expect(SetCosmeticsIntent.safeParse({ sleeveId: 'nao-existe' }).success).toBe(false);
    expect(SetCosmeticsIntent.safeParse({ petId: 'unicornio' }).success).toBe(false);
  });

  it('recusa campo desconhecido — nada de contrabandear dados no payload', () => {
    expect(
      SetCosmeticsIntent.safeParse({ sleeveId: 'aether-classic', sleeveUrl: 'https://x/y.png' })
        .success,
    ).toBe(false);
  });

  it('aceita payload parcial: trocar só o mascote não mexe no resto', () => {
    const r = SetCosmeticsIntent.safeParse({ petId: 'slime' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sleeveId).toBeUndefined();
  });

  it('o sleeve padrão do catálogo não é o verso da WotC', () => {
    // O verso oficial vinha de back.scryfall.io. O catálogo não referencia
    // URL nenhuma — cada item é cor e padrão, desenhados pelo cliente.
    const serializado = JSON.stringify(SLEEVES);
    expect(serializado).not.toMatch(/scryfall/i);
    expect(serializado).not.toMatch(/https?:/i);
  });
});
