/**
 * Quick-Add input parser. Extracts amount + note from natural-language
 * input like "350 coffee" or "2.500 market".
 *
 * Amounts are integer RSD. Thousand separators (. or ,) are stripped.
 * Decimals are dropped — household budget tracking in Serbia is
 * customarily integer-only.
 */

export interface ParsedInput {
  amount: number | null;
  note: string;
}

export function parseQuickAdd(raw: string): ParsedInput {
  const trimmed = raw.trim();
  if (!trimmed) return { amount: null, note: '' };

  // Number at the start: optional minus, digits with optional . , separators.
  const match = trimmed.match(/^(-?[\d.,]+)\s+(.+)$/);
  if (!match) {
    // No space → maybe a number-only input, treat as amount with empty note.
    const numOnly = trimmed.match(/^(-?[\d.,]+)$/);
    if (numOnly) {
      const cleaned = numOnly[1].replace(/[.,]/g, '');
      const amount = parseInt(cleaned, 10);
      return { amount: isNaN(amount) ? null : amount, note: '' };
    }
    return { amount: null, note: trimmed };
  }

  const cleaned = match[1].replace(/[.,]/g, '');
  const amount = parseInt(cleaned, 10);
  if (isNaN(amount)) return { amount: null, note: trimmed };
  return { amount, note: match[2].trim() };
}

/**
 * Keyword → category-id heuristic. Matches whole tokens in the note
 * against this map. v1.1 will learn per-household overrides; for now,
 * a fixed map seeded from the source Excel's recurring vendor names.
 */
const KEYWORD_MAP: Readonly<Record<string, string>> = {
  // OSTALO / Kafe i voda
  'kafa': 'ostalo-kafe', 'kafe': 'ostalo-kafe', 'coffee': 'ostalo-kafe',
  'sara': 'ostalo-kafe', 'voda': 'ostalo-kafe',

  // HRANA / Market
  'market': 'hrana-market', 'maxi': 'hrana-market', 'lidl': 'hrana-market',
  'idea': 'hrana-market', 'mercator': 'hrana-market', 'pekara': 'hrana-market',
  'mlinar': 'hrana-market', 'tempo': 'hrana-market', 'grocery': 'hrana-market',

  // HRANA / Restoran
  'restoran': 'hrana-restoran', 'restaurant': 'hrana-restoran',
  'ručak': 'hrana-restoran', 'rucak': 'hrana-restoran',
  'večera': 'hrana-restoran', 'vecera': 'hrana-restoran',
  'lunch': 'hrana-restoran', 'dinner': 'hrana-restoran',
  'vapiano': 'hrana-restoran', 'mcdonalds': 'hrana-restoran', 'burger': 'hrana-restoran',
  'pizza': 'hrana-restoran',

  // KREDIT
  'kredit': 'kredit', 'rata': 'kredit', 'loan': 'kredit',

  // AUTO
  'gorivo': 'auto', 'fuel': 'auto', 'gas': 'auto',
  'nis': 'auto', 'omv': 'auto', 'mol': 'auto', 'lukoil': 'auto',
  'auto': 'auto', 'servis': 'auto', 'mehanicar': 'auto', 'mehaničar': 'auto',

  // RAČUNI
  'racuni': 'racuni', 'računi': 'racuni',
  'struja': 'racuni', 'eps': 'racuni',
  'internet': 'racuni', 'sbb': 'racuni', 'yettel': 'racuni', 'mts': 'racuni',
  'telefon': 'racuni', 'gas-racun': 'racuni',
  'infostan': 'racuni', 'grejanje': 'racuni',

  // OSTALO / Hemikalije
  'dm': 'ostalo-hemikalije', 'apoteka': 'ostalo-hemikalije',
  'lilly': 'ostalo-hemikalije', 'bipa': 'ostalo-hemikalije',
  'farmasi': 'ostalo-hemikalije', 'parfem': 'ostalo-hemikalije',

  // OSTALO / Stan
  'stan': 'ostalo-stan', 'kirija': 'ostalo-stan', 'kućni': 'ostalo-stan', 'kucni': 'ostalo-stan',

  // NANA
  'nana': 'nana', 'vrtic': 'nana', 'vrtić': 'nana', 'park': 'nana',
  'igraonica': 'nana', 'bebac': 'nana', 'baby': 'nana',

  // POKLONI
  'poklon': 'pokloni', 'pokloni': 'pokloni', 'gift': 'pokloni',
  'rodjendan': 'pokloni', 'rođendan': 'pokloni',

  // MI / Telo (health & body)
  'telo': 'mi-telo', 'fitness': 'mi-telo', 'fitnes': 'mi-telo',
  'teretana': 'mi-telo', 'lekar': 'mi-telo', 'doktor': 'mi-telo',
  'stomatolog': 'mi-telo',

  // MI / Um (mind / education)
  'um': 'mi-um', 'knjiga': 'mi-um', 'book': 'mi-um', 'kurs': 'mi-um',
  'course': 'mi-um', 'udemy': 'mi-um',

  // KARTICE / Hrana
  'banca': 'kartice-hrana', 'kreditna': 'kartice-hrana',

  // OSTALO / Majke
  'mama': 'ostalo-majke', 'tata': 'ostalo-majke', 'majke': 'ostalo-majke',
};

/**
 * Returns an array of suggested category IDs (de-duplicated, top of
 * the list is the best guess). Always includes a fallback at the end
 * if nothing matched.
 */
export function suggestCategories(note: string, fallbackId = 'ostalo-ostalo'): string[] {
  const tokens = note.toLowerCase().split(/[\s,.;:!?()]+/).filter(Boolean);
  const out: string[] = [];
  for (const token of tokens) {
    const cat = KEYWORD_MAP[token];
    if (cat && !out.includes(cat)) out.push(cat);
  }
  if (out.length === 0) out.push(fallbackId);
  return out;
}
