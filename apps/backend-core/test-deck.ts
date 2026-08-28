import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const decks = await prisma.deck.findMany({
    include: {
      cards: true
    }
  });

  console.log(`Found ${decks.length} decks.`);
  
  for (const deck of decks) {
    console.log(`\nDeck: ${deck.name} (ID: ${deck.id})`);
    console.log(`Card Count (DB Field): ${deck.cardCount}`);
    
    let totalQuantity = 0;
    deck.cards.forEach(card => {
      totalQuantity += card.quantity;
    });
    
    console.log(`Total Quantity in cards array: ${totalQuantity}`);
    console.log(`Number of distinct cards: ${deck.cards.length}`);
    
    // Print first 5 cards to see details
    console.log('First 5 cards:', JSON.stringify(deck.cards.slice(0, 5), null, 2));
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
