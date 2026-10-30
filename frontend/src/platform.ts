/** Discovery metadata contains ideas, never fabricated on-chain market data. */
export const CATEGORIES = [
  {id: 'all', label: 'All markets', icon: 'grid'},
  {id: 'crypto', label: 'Crypto', icon: 'bitcoin'},
  {id: 'sports', label: 'Sports', icon: 'trophy'},
  {id: 'politics', label: 'Politics', icon: 'globe'},
  {id: 'technology', label: 'Technology', icon: 'chip'},
  {id: 'economy', label: 'Economy', icon: 'chart'},
  {id: 'culture', label: 'Culture', icon: 'sparkles'},
] as const;

export type Category = typeof CATEGORIES[number]['id'];
export type TopicCategory = Exclude<Category, 'all'>;

export interface MarketIdea {
  id: string;
  category: TopicCategory;
  title: string;
  description: string;
  days: number;
  symbol: string;
}

export const MARKET_IDEAS: readonly MarketIdea[] = [
  {id: 'bitcoin-120k', category: 'crypto', title: 'Will Bitcoin reach $120,000 in the next 30 days?',
    description: 'Where does Bitcoin go from here?', days: 30, symbol: '₿'},
  {id: 'football-final', category: 'sports', title: 'Will the next football final go to penalties?',
    description: 'Pick the competition. Call the outcome.', days: 14, symbol: 'FC'},
  {id: 'ai-model', category: 'technology', title: 'Will an open-source AI model top the benchmarks this month?',
    description: 'The next breakthrough could come from anywhere.', days: 30, symbol: 'AI'},
  {id: 'gold-record', category: 'economy', title: 'Will gold hit a new all-time high in 30 days?',
    description: 'Follow the next move in global markets.', days: 30, symbol: 'Au'},
  {id: 'election-turnout', category: 'politics', title: 'Will turnout exceed 75% in the next election?',
    description: 'Define the election and the official results source.', days: 90, symbol: '75'},
  {id: 'ethereum-5k', category: 'crypto', title: 'Will Ethereum break $5,000 in the next 30 days?',
    description: 'What’s the next chapter for Ethereum?', days: 30, symbol: 'Ξ'},
  {id: 'box-office', category: 'culture', title: 'Will your film pick cross $1 billion at the box office?',
    description: 'Big stories. Bigger expectations.', days: 60, symbol: '▶'},
  {id: 'space-launch', category: 'technology', title: 'Will a new Moon mission launch in the next 90 days?',
    description: 'Follow the next leap in space exploration.', days: 90, symbol: '↑'},
  {id: 'basketball-final', category: 'sports', title: 'Will your basketball finals pick go to Game 7?',
    description: 'Create a market for the deciding series.', days: 30, symbol: 'VII'},
];

export function isCategory(value: string): value is Category {
  return CATEGORIES.some((category) => category.id === value);
}

export function categoryForQuestion(question: string): TopicCategory {
  if (/bitcoin|ethereum|\bbtc\b|\beth\b|crypto|kripto|\bqie\b|blockchain|token|solana/i.test(question)) return 'crypto';
  if (/bola|basket|final|liga|league|football|sport|sepak|penalti|badminton|tenis|tennis/i.test(question)) return 'sports';
  if (/pemilu|election|presiden|parlemen|politik|pilkada|vot(e|ing)/i.test(question)) return 'politics';
  if (/\bai\b|model|teknologi|technology|open.?source|bulan|moon|space|roket|robot/i.test(question)) return 'technology';
  if (/emas|gold|ekonomi|econom|inflasi|inflation|suku bunga|saham|dolar|rupiah|\bgdp\b/i.test(question)) return 'economy';
  return 'culture';
}

export function filterIdeas(query: string, category: Category): MarketIdea[] {
  const term = query.trim().toLocaleLowerCase('en-US');
  return MARKET_IDEAS.filter((idea) => (category === 'all' || idea.category === category) &&
    (!term || `${idea.title} ${idea.description}`.toLocaleLowerCase('en-US').includes(term)));
}

export function marketBookmarkKey(address: string, id: bigint): string {
  return `market:${address.toLowerCase()}:${id}`;
}

export function parseBookmarks(raw: string | null): Set<string> {
  try {
    const values: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(values)) return new Set();
    return new Set(values.filter((value): value is string => typeof value === 'string' &&
      /^(idea:[a-z0-9-]+|market:0x[0-9a-f]{40}:\d+)$/.test(value)).slice(0, 500));
  } catch {
    return new Set();
  }
}

export function icon(name: string, size = 20): string {
  const paths: Record<string, string> = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    bitcoin: '<circle cx="12" cy="12" r="9"/><path d="m10 6-2 12m5-12-2 12M8.5 8h5a2.5 2.5 0 0 1 0 5H8m.5-1H14a2.5 2.5 0 0 1 0 5H7"/>',
    trophy: '<path d="M8 3h8v6a4 4 0 0 1-8 0V3Zm4 10v7m-4 1h8M8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="3"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/>',
    chart: '<path d="M4 3v17h17M8 15l4-5 4 2 5-7m-5 0h5v5"/>',
    sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Zm7 0v4m-2-2h4"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    bookmark: '<path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4V4Z"/>',
    wallet: '<path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v12H6a3 3 0 0 1-3-3V6"/><path d="M20 12h-5v5h5m-3-2.5h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1 1 3-3 2 3 2-1 3 3 1 1 3 3-1 3 1 1-3 3-1-1-3 3-2-3-2 1-3-3-1-1-3-3 1-3-1Z"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2L12 12v2m0 3h.01"/>',
    refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M9 3H4v17h17v-5"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.grid}</svg>`;
}
