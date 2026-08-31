'use client';

/**
 * render.ts — desenha os cosméticos.
 *
 * Cada sleeve e cada playmat do catálogo é uma DESCRIÇÃO (duas cores e um nome
 * de padrão), não um arquivo. Aqui essa descrição vira um `<canvas>` que o
 * Konva usa como imagem, e o resultado é cacheado por id.
 *
 * Por que procedural, e não PNG:
 *   - nenhum asset para servir, versionar ou revisar por direito autoral;
 *   - nítido em qualquer densidade de tela, sem @2x/@3x;
 *   - o catálogo inteiro funciona offline e não custa uma requisição.
 *
 * O verso PADRÃO das cartas nasce daqui. Antes ele vinha de
 * `back.scryfall.io/large/back.jpg` — o verso oficial da WotC, que DOC-060
 * §2.1 proíbe explicitamente de usar.
 */

import {
  acharPet,
  acharPlaymat,
  acharSleeve,
  type Pet,
  type Playmat,
  type Sleeve,
} from '@aethertable/shared-types';

/** Resolução base do sleeve. Alta o bastante para dar zoom sem serrilhar. */
const SLEEVE_W = 252;
const SLEEVE_H = 352;

const cacheSleeve = new Map<string, HTMLCanvasElement>();
const cachePlaymat = new Map<string, HTMLCanvasElement>();

function novoCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function caminhoArredondado(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ─── Sleeves ─────────────────────────────────────────────────────────────────

function desenharPadraoSleeve(ctx: CanvasRenderingContext2D, s: Sleeve): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.save();
  ctx.strokeStyle = s.detalhe;
  ctx.fillStyle = s.detalhe;
  ctx.globalAlpha = 0.14;
  ctx.lineWidth = 2;

  switch (s.padrao) {
    case 'losango': {
      const passo = 34;
      for (let y = -passo; y < h + passo; y += passo) {
        for (let x = -passo; x < w + passo; x += passo) {
          ctx.beginPath();
          ctx.moveTo(x + passo / 2, y);
          ctx.lineTo(x + passo, y + passo / 2);
          ctx.lineTo(x + passo / 2, y + passo);
          ctx.lineTo(x, y + passo / 2);
          ctx.closePath();
          ctx.stroke();
        }
      }
      break;
    }
    case 'raios': {
      const cx = w / 2;
      const cy = h / 2;
      for (let i = 0; i < 24; i += 1) {
        const a = (i / 24) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * w, cy + Math.sin(a) * h);
        ctx.stroke();
      }
      break;
    }
    case 'ondas': {
      for (let y = 20; y < h; y += 26) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const yy = y + Math.sin((x / w) * Math.PI * 4) * 7;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      break;
    }
    case 'grade': {
      for (let x = 0; x <= w; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += 24) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      break;
    }
    case 'circuito': {
      // Trilhas de circuito: segmentos ortogonais com terminais em ponto.
      let x = 20;
      let y = 20;
      for (let i = 0; i < 60; i += 1) {
        const horizontal = i % 2 === 0;
        const passo = 18 + ((i * 37) % 46);
        ctx.beginPath();
        ctx.moveTo(x, y);
        if (horizontal) x = Math.min(w - 12, x + passo);
        else y = Math.min(h - 12, y + passo);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        if (x >= w - 12) x = 20;
        if (y >= h - 12) y = 20;
      }
      break;
    }
    case 'liso':
    default:
      break;
  }
  ctx.restore();
}

/** Monograma "AT" — a marca da plataforma no lugar do verso da WotC. */
function desenharMonograma(ctx: CanvasRenderingContext2D, s: Sleeve): void {
  const { width: w, height: h } = ctx.canvas;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.22;

  ctx.save();
  ctx.globalAlpha = 0.9;

  const brilho = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.7);
  brilho.addColorStop(0, `${s.detalhe}44`);
  brilho.addColorStop(1, '#00000000');
  ctx.fillStyle = brilho;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = s.detalhe;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.28, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.fillStyle = s.detalhe;
  ctx.font = `bold ${Math.round(r * 0.92)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('AT', cx, cy + 1);
  ctx.restore();
}

/** Canvas do sleeve, pronto para virar imagem do Konva. Cacheado por id. */
export function sleeveCanvas(sleeveId?: string): HTMLCanvasElement | null {
  const s = acharSleeve(sleeveId);
  const emCache = cacheSleeve.get(s.id);
  if (emCache) return emCache;

  const c = novoCanvas(SLEEVE_W, SLEEVE_H);
  if (!c) return null;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  const g = ctx.createLinearGradient(0, 0, SLEEVE_W, SLEEVE_H);
  g.addColorStop(0, s.cores[0]);
  g.addColorStop(1, s.cores[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SLEEVE_W, SLEEVE_H);

  desenharPadraoSleeve(ctx, s);
  desenharMonograma(ctx, s);

  // Moldura interna: é o que dá a leitura de "carta encapada".
  ctx.strokeStyle = s.borda;
  ctx.lineWidth = 8;
  caminhoArredondado(ctx, 8, 8, SLEEVE_W - 16, SLEEVE_H - 16, 14);
  ctx.stroke();

  cacheSleeve.set(s.id, c);
  return c;
}

// ─── Playmats ────────────────────────────────────────────────────────────────

const PLAYMAT_W = 960;
const PLAYMAT_H = 320;

function desenharPadraoPlaymat(ctx: CanvasRenderingContext2D, p: Playmat): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.save();
  ctx.strokeStyle = p.destaque;
  ctx.fillStyle = p.destaque;

  switch (p.padrao) {
    case 'nebulosa': {
      // Manchas suaves: dá profundidade sem competir com a arte das cartas.
      for (let i = 0; i < 22; i += 1) {
        const x = ((i * 137) % w) + 20;
        const y = ((i * 251) % h) + 10;
        const r = 40 + ((i * 53) % 130);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `${p.destaque}26`);
        g.addColorStop(1, '#00000000');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      break;
    }
    case 'hexagonos': {
      ctx.globalAlpha = 0.12;
      ctx.lineWidth = 1.5;
      const lado = 26;
      const alturaHex = Math.sqrt(3) * lado;
      for (let linha = 0; linha * (alturaHex / 2) < h + alturaHex; linha += 1) {
        const y = linha * (alturaHex / 2);
        const deslocamento = linha % 2 === 0 ? 0 : lado * 1.5;
        for (let x = deslocamento; x < w + lado * 3; x += lado * 3) {
          ctx.beginPath();
          for (let k = 0; k < 6; k += 1) {
            const a = (Math.PI / 3) * k;
            const px = x + Math.cos(a) * lado;
            const py = y + Math.sin(a) * lado;
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
      break;
    }
    case 'linhas': {
      ctx.globalAlpha = 0.1;
      ctx.lineWidth = 2;
      for (let x = -h; x < w; x += 22) {
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x + h, 0);
        ctx.stroke();
      }
      break;
    }
    case 'runas': {
      ctx.globalAlpha = 0.14;
      ctx.lineWidth = 2;
      for (let i = 0; i < 26; i += 1) {
        const x = ((i * 173) % (w - 60)) + 30;
        const y = ((i * 97) % (h - 60)) + 30;
        const r = 12 + ((i * 7) % 16);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - r, y);
        ctx.lineTo(x + r, y);
        ctx.moveTo(x, y - r);
        ctx.lineTo(x, y + r);
        ctx.stroke();
      }
      break;
    }
    case 'liso':
    default:
      break;
  }
  ctx.restore();
}

export function playmatCanvas(playmatId?: string): HTMLCanvasElement | null {
  const p = acharPlaymat(playmatId);
  const emCache = cachePlaymat.get(p.id);
  if (emCache) return emCache;

  const c = novoCanvas(PLAYMAT_W, PLAYMAT_H);
  if (!c) return null;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  const g = ctx.createLinearGradient(0, 0, PLAYMAT_W, PLAYMAT_H);
  g.addColorStop(0, p.cores[0]);
  g.addColorStop(1, p.cores[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PLAYMAT_W, PLAYMAT_H);

  desenharPadraoPlaymat(ctx, p);

  // DOC-060 §2.2: overlay preto a 40% para a carta nunca se perder no fundo.
  // É a diretriz de "Imersão Neutra" — o playmat é ambiente, não protagonista.
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 0, PLAYMAT_W, PLAYMAT_H);

  cachePlaymat.set(p.id, c);
  return c;
}

// ─── Mascotes ────────────────────────────────────────────────────────────────

/**
 * Silhueta do mascote, em coordenadas de -1..1. O componente do canvas aplica
 * escala, posição e a animação — aqui só a forma.
 */
export function caminhoDoPet(pet: Pet): Array<[number, number]> | null {
  switch (pet.forma) {
    case 'slime':
      return [
        [-1, 0.9],
        [-1, 0.15],
        [-0.72, -0.5],
        [-0.28, -0.85],
        [0.28, -0.85],
        [0.72, -0.5],
        [1, 0.15],
        [1, 0.9],
      ];
    case 'coruja':
      return [
        [-0.75, -0.5],
        [-0.5, -0.95],
        [-0.2, -0.6],
        [0.2, -0.6],
        [0.5, -0.95],
        [0.75, -0.5],
        [0.85, 0.25],
        [0.4, 0.95],
        [-0.4, 0.95],
        [-0.85, 0.25],
      ];
    case 'gato':
      return [
        [-0.8, -0.35],
        [-0.6, -0.95],
        [-0.25, -0.5],
        [0.25, -0.5],
        [0.6, -0.95],
        [0.8, -0.35],
        [0.85, 0.5],
        [0.3, 0.95],
        [-0.3, 0.95],
        [-0.85, 0.5],
      ];
    case 'dragao':
      return [
        [-1, 0.1],
        [-0.45, -0.3],
        [-0.2, -0.95],
        [0.1, -0.35],
        [0.75, -0.55],
        [0.45, 0.1],
        [1, 0.55],
        [0.15, 0.5],
        [-0.1, 0.95],
        [-0.4, 0.45],
      ];
    case 'fenix':
      return [
        [-1, -0.2],
        [-0.35, -0.55],
        [0, -1],
        [0.35, -0.55],
        [1, -0.2],
        [0.45, 0.2],
        [0.65, 0.95],
        [0, 0.45],
        [-0.65, 0.95],
        [-0.45, 0.2],
      ];
    case 'nenhum':
    default:
      return null;
  }
}

export { acharPet, acharPlaymat, acharSleeve };
