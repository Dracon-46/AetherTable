/**
 * `Symbol.metadata` e exigido pelos decoradores do @colyseus/schema 3.x e ainda
 * nao existe em todo runtime Node 22. O cast era `as any`, que o lint bloqueia:
 * a forma tipada expressa exatamente o mesmo sem abrir mao da checagem.
 */
if (typeof Symbol.metadata === 'undefined') {
  (Symbol as unknown as { metadata: symbol }).metadata = Symbol.for('Symbol.metadata');
}

export {};
