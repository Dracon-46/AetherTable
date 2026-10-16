/**
 * config.spec.ts — o endereço da API.
 *
 * O `render.yaml` injeta o nome INTERNO do serviço (`aethertable-api`), que no
 * plano gratuito do Render não recebe tráfego: o game server não alcançava a
 * API e o grimório não carregava. Nome interno vira o endereço público.
 */

import { esquemaDaConfig } from './config';

const url = (v: string) => esquemaDaConfig.shape.BACKEND_CORE_URL.parse(v);

it('nome interno do Render vira o endereço público', () => {
  expect(url('aethertable-api')).toBe('https://aethertable-api.onrender.com');
});

it('endereço completo passa intacto', () => {
  expect(url('https://aethertable-api.onrender.com')).toBe('https://aethertable-api.onrender.com');
  expect(url('http://localhost:3333')).toBe('http://localhost:3333');
});

it('host com domínio e sem esquema ganha https', () => {
  expect(url('api.aethertable.gg')).toBe('https://api.aethertable.gg');
});

it('localhost sem esquema não vira onrender', () => {
  expect(url('localhost:3333')).toBe('https://localhost:3333');
});
