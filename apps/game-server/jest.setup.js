// ─── A SUÍTE NÃO DEPENDE DO `.env` DE QUEM RODA ─────────────────────────────
//
// `src/config.ts` valida o ambiente NA IMPORTAÇÃO e recusa subir sem
// `JWT_SECRET`. Na máquina de quem desenvolve o `.env` existe e esconde isso;
// no CI ele não existe, e todo spec que importa o config (direta ou
// indiretamente) quebrava antes do primeiro teste — `config.spec.ts` deixou a
// `main` vermelha assim.
//
// `??=` e não `=`: quem quiser rodar contra o próprio segredo continua podendo.
process.env.JWT_SECRET ??= 'segredo-de-teste-com-16+';
