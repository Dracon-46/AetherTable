// Com prisma.config.ts presente, o Prisma NAO carrega .env automaticamente
// ("Prisma config detected, skipping environment variable loading").
// Por isso o dotenv e explicito aqui.
import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Substitui a chave `prisma` do package.json, deprecada e removida no Prisma 7.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
