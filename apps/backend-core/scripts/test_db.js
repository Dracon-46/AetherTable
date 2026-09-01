const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  const users = await prisma.user.findMany();
  console.log('Users:', users);

  const decks = await prisma.deck.findMany();
  console.log('Decks:', decks);
}

test().finally(() => prisma.$disconnect());
