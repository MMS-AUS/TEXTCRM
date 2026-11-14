import { like } from 'drizzle-orm';
import { parseArgs } from 'node:util';
import {
  areaForPostcode,
  LEAD_LOST,
  LEAD_PIPELINE,
  nearestBigCity,
  stateForPostcode,
} from '@mms/shared';
import { createDb, type Db } from './client.ts';
import { leads, users } from './schema/index.ts';
import { requireDatabaseUrl } from '../env.ts';

/**
 * Made-up leads for performance testing (Step 2.2: "10,000 seeded fake leads page and filter
 * instantly"). Every fake lead has a `sheetLeadId` starting with "fake-" so `--remove` can
 * delete exactly them. Never run against production.
 */

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
  'Leo',
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
const PLACES: [suburb: string, postcode: string][] = [
  ['Parramatta', '2150'],
  ['Penrith', '2750'],
  ['Newcastle', '2300'],
  ['Wollongong', '2500'],
  ['Brisbane', '4000'],
  ['Toowoomba', '4350'],
  ['Ipswich', '4305'],
  ['Southport', '4215'],
  ['Geelong', '3220'],
  ['Ballarat', '3350'],
  ['Adelaide', '5000'],
  ['Canberra', '2600'],
  ['Hobart', '7000'],
  ['Perth', '6000'],
];
const SOURCES = [
  'Meta',
  'Google Ads',
  'Website',
  'Energy Matters',
  'Referral',
  'Inbound',
  'Quote 8',
  '3 Quotes',
];
const STATUSES = [...LEAD_PIPELINE, LEAD_LOST];

export function fakeLeads(count: number, ownerIds: string[], today = new Date()) {
  return Array.from({ length: count }, (_, i) => {
    const [suburb, postcode] = PLACES[i % PLACES.length] ?? ['Parramatta', '2150'];
    const state = stateForPostcode(postcode) ?? 'NSW';
    const date = new Date(today.getTime() - (i % 400) * 86_400_000);
    return {
      firstName: FIRST[i % FIRST.length] ?? 'Sam',
      lastName: LAST[(i * 7) % LAST.length] ?? null,
      email: `fake.lead.${String(i)}@example.com`,
      mobile: `+614${String(10_000_000 + i).padStart(8, '0')}`,
      streetAddress: `${String((i % 180) + 1)} Example St`,
      suburb,
      state,
      postcode,
      area: areaForPostcode(postcode),
      nearestBigCity: nearestBigCity(postcode, state),
      source: SOURCES[i % SOURCES.length] ?? null,
      status: STATUSES[(i * 3) % STATUSES.length] ?? 'New',
      ownerUserId:
        ownerIds.length > 0 && i % 4 !== 0 ? (ownerIds[i % ownerIds.length] ?? null) : null,
      leadDate: date.toISOString().slice(0, 10),
      sheetLeadId: `fake-${String(i)}`,
    };
  });
}

export async function insertFakeLeads(db: Db, count: number): Promise<void> {
  const owners = (await db.select({ id: users.id }).from(users)).map((u) => u.id);
  const rows = fakeLeads(count, owners);
  for (let start = 0; start < rows.length; start += 1000) {
    await db.insert(leads).values(rows.slice(start, start + 1000));
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to add fake leads to a production database.');
  }
  const { values } = parseArgs({
    options: {
      count: { type: 'string', default: '10000' },
      remove: { type: 'boolean', default: false },
    },
  });
  const db = createDb(requireDatabaseUrl('DATABASE_URL'));
  try {
    if (values.remove) {
      const removed = await db
        .delete(leads)
        .where(like(leads.sheetLeadId, 'fake-%'))
        .returning({ id: leads.id });
      console.log(`Removed ${String(removed.length)} fake leads.`);
      return;
    }
    const count = Number(values.count);
    if (!Number.isInteger(count) || count < 1 || count > 100_000) {
      throw new Error('--count must be a whole number between 1 and 100000.');
    }
    await insertFakeLeads(db, count);
    console.log(
      `Added ${String(count)} fake leads. Remove them with: npm run db:fake-leads -- --remove`,
    );
  } finally {
    await db.$client.end();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
