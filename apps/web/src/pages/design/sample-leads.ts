import type { PaginationState, SortingState } from '../../ui/index.ts';

// Made-up rows for the /design preview only — never used by real screens.

export const SAMPLE_STATUSES = ['New', 'Contacted', 'Quoted', 'Won', 'Lost'] as const;
export type SampleStatus = (typeof SAMPLE_STATUSES)[number];

export type SampleLead = {
  id: string;
  name: string;
  suburb: string;
  state: string;
  source: string;
  systemKw: number;
  quote: number;
  status: SampleStatus;
  createdAt: string;
};

const FIRST = [
  'Olivia',
  'Liam',
  'Charlotte',
  'Noah',
  'Amelia',
  'Jack',
  'Isla',
  'Oliver',
  'Mia',
  'William',
  'Ava',
  'Thomas',
  'Grace',
  'Lucas',
  'Chloe',
  'Henry',
  'Zoe',
  'Ethan',
  'Ruby',
];
const LAST = [
  'Nguyen',
  'Smith',
  'Patel',
  'Williams',
  'Brown',
  'Singh',
  'Taylor',
  'Wilson',
  'Chen',
  'Martin',
  'Kelly',
  'Anderson',
  'Walker',
  'Harris',
  'Thompson',
  'Ryan',
];
const PLACES: [string, string][] = [
  ['Parramatta', 'NSW'],
  ['Penrith', 'NSW'],
  ['Newcastle', 'NSW'],
  ['Wollongong', 'NSW'],
  ['Brisbane', 'QLD'],
  ['Toowoomba', 'QLD'],
  ['Ipswich', 'QLD'],
  ['Gold Coast', 'QLD'],
  ['Geelong', 'VIC'],
  ['Ballarat', 'VIC'],
  ['Adelaide', 'SA'],
  ['Canberra', 'ACT'],
  ['Hobart', 'TAS'],
  ['Perth', 'WA'],
];
const SOURCES = ['Meta ads', 'Google', 'Website', 'Energy Matters', 'Quote 8', 'Referral'];
const SIZES = [6.6, 8.2, 10, 10.56, 13.2, 6.6, 9.9, 15];

export const SAMPLE_LEADS: SampleLead[] = Array.from({ length: 57 }, (_, i) => {
  const place = PLACES[(i * 5) % PLACES.length] ?? ['Sydney', 'NSW'];
  const systemKw = SIZES[(i * 3) % SIZES.length] ?? 6.6;
  const day = new Date(Date.UTC(2026, 9, 31) - i * 86_400_000 * 0.9);
  return {
    id: `lead-${String(i + 1).padStart(3, '0')}`,
    name: `${FIRST[i % FIRST.length] ?? ''} ${LAST[(i * 7) % LAST.length] ?? ''}`,
    suburb: place[0],
    state: place[1],
    source: SOURCES[(i * 11) % SOURCES.length] ?? 'Website',
    systemKw,
    quote: Math.round(systemKw * 1090 + (i % 4) * 2400 + ((i * 37) % 9) * 110),
    status: SAMPLE_STATUSES[(i * 3 + Math.floor(i / 4)) % SAMPLE_STATUSES.length] ?? 'New',
    createdAt: day.toISOString(),
  };
});

export type SampleQuery = { search: string; sorting: SortingState; pagination: PaginationState };

/** Stands in for a server procedure: filter, sort, then return one page and the total. */
export function querySampleLeads({ search, sorting, pagination }: SampleQuery) {
  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? SAMPLE_LEADS.filter((lead) =>
        `${lead.name} ${lead.suburb} ${lead.state}`.toLowerCase().includes(needle),
      )
    : SAMPLE_LEADS;

  const sort = sorting[0];
  const sorted = sort
    ? filtered.toSorted((a, b) => {
        const key = sort.id as keyof SampleLead;
        const left = a[key];
        const right = b[key];
        const order =
          typeof left === 'number' && typeof right === 'number'
            ? left - right
            : String(left).localeCompare(String(right));
        return sort.desc ? -order : order;
      })
    : filtered;

  const start = pagination.pageIndex * pagination.pageSize;
  return { rows: sorted.slice(start, start + pagination.pageSize), total: sorted.length };
}
