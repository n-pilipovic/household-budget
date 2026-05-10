/**
 * Fixed taxonomy from the source Excel sheet ("Vođenje troškova").
 * Seeded into every new household at creation time. IDs are stable so
 * later renames in v1.1 only mutate the `name` field, never the doc id.
 */
export interface SeedCategory {
  readonly id: string;
  readonly group: string;       // top-level group, e.g. 'HRANA'
  readonly name: string;        // sub-category label, e.g. 'Market'
  readonly icon?: string;       // lucide icon name (optional)
  readonly sortOrder: number;
}

export const SEED_CATEGORIES: readonly SeedCategory[] = [
  // MI — investments / education / health
  { id: 'mi-ulaganja', group: 'MI', name: 'Ulaganja', icon: 'trending-up', sortOrder: 10 },
  { id: 'mi-um',       group: 'MI', name: 'Um',       icon: 'brain',       sortOrder: 11 },
  { id: 'mi-telo',     group: 'MI', name: 'Telo',     icon: 'heart',       sortOrder: 12 },

  // NANA
  { id: 'nana', group: 'NANA', name: 'Nana', icon: 'baby', sortOrder: 20 },

  // KREDIT
  { id: 'kredit', group: 'KREDIT', name: 'Kredit', icon: 'credit-card', sortOrder: 30 },

  // KARTICE
  { id: 'kartice-rate',    group: 'KARTICE', name: 'Rate',    icon: 'calendar-clock', sortOrder: 40 },
  { id: 'kartice-hrana',   group: 'KARTICE', name: 'Hrana',   icon: 'utensils',       sortOrder: 41 },
  { id: 'kartice-pokloni', group: 'KARTICE', name: 'Pokloni', icon: 'gift',           sortOrder: 42 },

  // RAČUNI
  { id: 'racuni', group: 'RAČUNI', name: 'Računi', icon: 'file-text', sortOrder: 50 },

  // AUTO
  { id: 'auto', group: 'AUTO', name: 'Auto', icon: 'car', sortOrder: 60 },

  // HRANA
  { id: 'hrana-market',   group: 'HRANA', name: 'Market',   icon: 'shopping-cart', sortOrder: 70 },
  { id: 'hrana-restoran', group: 'HRANA', name: 'Restoran', icon: 'utensils',      sortOrder: 71 },

  // POKLONI
  { id: 'pokloni', group: 'POKLONI', name: 'Pokloni', icon: 'gift', sortOrder: 80 },

  // OSTALO
  { id: 'ostalo-hemikalije', group: 'OSTALO', name: 'Hemikalije',   icon: 'flask-conical', sortOrder: 90 },
  { id: 'ostalo-kafe',       group: 'OSTALO', name: 'Kafe i voda',  icon: 'coffee',        sortOrder: 91 },
  { id: 'ostalo-stan',       group: 'OSTALO', name: 'Stan',         icon: 'home',          sortOrder: 92 },
  { id: 'ostalo-majke',      group: 'OSTALO', name: 'Majke',        icon: 'user',          sortOrder: 93 },
  { id: 'ostalo-ostalo',     group: 'OSTALO', name: 'Ostalo',       icon: 'circle',        sortOrder: 94 },
];
