/**
 * dicionarios.spec.ts — as traduções.
 *
 * O texto em português é a chave (ver i18n.ts). O risco desse desenho é a
 * tradução ÓRFÃ: alguém muda o texto em português e a entrada antiga do
 * dicionário fica apontando para um texto que não existe mais — a tela volta
 * a aparecer em português sem ninguém perceber. Este teste procura cada chave
 * no código-fonte.
 */

import fs from 'node:fs';
import path from 'node:path';
import { traduzir } from './i18n';
import { EN } from './en';

jest.mock('../store/aparencia.store', () => ({ useAparencia: jest.fn() }));

function fontes(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return fontes(p);
    return /\.(tsx?|ts)$/.test(e.name) &&
      !/\.spec\./.test(e.name) &&
      !p.includes(`${path.sep}i18n${path.sep}`)
      ? [p]
      : [];
  });
}

it('português passa direto; inglês traduz; sem tradução cai no português', () => {
  expect(traduzir('pt-BR', 'Meus Grimórios')).toBe('Meus Grimórios');
  expect(traduzir('en', 'Meus Grimórios')).toBe('My Decks');
  expect(traduzir('en', 'Texto que ninguém traduziu')).toBe('Texto que ninguém traduziu');
});

it('interpola {nome} nos dois idiomas', () => {
  expect(traduzir('en', 'Notificações: {n} novas', { n: 3 })).toBe('Notifications: 3 new');
  expect(traduzir('pt-BR', 'Notificações: {n} novas', { n: 3 })).toBe('Notificações: 3 novas');
});

it('nenhuma tradução órfã: toda chave do inglês aparece no código', () => {
  const codigo = fontes(path.join(__dirname, '..'))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');
  const orfas = Object.keys(EN).filter((k) => !codigo.includes(k));
  expect(orfas).toEqual([]);
});
