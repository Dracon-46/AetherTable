async function test() {
  const rawText = '1 Sol Ring\n4 Lightning Bolt';
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const parsedCards = [];

  const LINE_REGEX =
    /^\s*(?<qty>\d+)\s*[xX]?\s+(?<name>[^([#*]+?)\s*(?:\((?<set1>[A-Za-z0-9]{2,5})\)\s*(?<cn>\S+)?)?\s*(?:\[(?<set2>[A-Za-z0-9]{2,5})\])?\s*(?:\*F\*)?\s*(?:#.*)?$/;

  for (const line of lines) {
    if (line.startsWith('#') || line.startsWith('//') || line.toUpperCase().startsWith('SIDEBOARD'))
      continue;

    const match = line.match(LINE_REGEX);
    if (match && match.groups) {
      const qty = parseInt(match.groups['qty'] ?? '1', 10);
      const name = match.groups['name'].trim();
      const set = match.groups['set1'] ?? match.groups['set2'];
      parsedCards.push({ quantity: qty, name, set });
    } else {
      const fbMatch = line.match(/^(\d+)x?\s+(.+)$/);
      if (fbMatch && fbMatch[1] && fbMatch[2]) {
        parsedCards.push({ quantity: parseInt(fbMatch[1], 10), name: fbMatch[2].trim() });
      } else {
        parsedCards.push({ quantity: 1, name: line.trim() });
      }
    }
  }

  console.log('Parsed:', parsedCards);

  const identifiers = parsedCards.map((c) => {
    const idObj = { name: c.name };
    if (c.set) idObj['set'] = c.set.toLowerCase();
    return idObj;
  });

  console.log('Identifiers:', identifiers);

  try {
    const scryRes = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers }),
    });

    console.log('Status:', scryRes.status);
    const scryData = await scryRes.json();
    console.log('Response:', JSON.stringify(scryData, null, 2));
  } catch (e) {
    console.error('Fetch error:', e);
  }
}

test();
