import path from 'node:path';
import { parseArgs } from 'node:util';
import { createDb } from '../db/client.ts';
import { requireDatabaseUrl } from '../env.ts';
import { loadLegacyData } from '../modules/legacy/legacy-data.ts';
import { migrateLegacy, type ReportLine } from '../modules/legacy/migrate.ts';

// Step 3.4 — moves the real records from the old CRM (§1.9). Dry run by default:
//   npm run legacy:migrate -- --as you@makemysolar.com.au
//   npm run legacy:migrate -- --as you@makemysolar.com.au --commit
// Options: --from <old project folder> (default ../MMSCRM_V2.0-main next to this repo),
//          --keep-both (don't merge the two Rojin Piya leads), --include-suspect.

const { values } = parseArgs({
  options: {
    as: { type: 'string' },
    from: { type: 'string' },
    commit: { type: 'boolean', default: false },
    'keep-both': { type: 'boolean', default: false },
    'include-suspect': { type: 'boolean', default: false },
  },
});

if (!values.as) {
  console.error(
    'Usage: npm run legacy:migrate -- --as you@makemysolar.com.au [--commit] [--keep-both] [--include-suspect] [--from ../MMSCRM_V2.0-main]',
  );
  process.exit(1);
}

// npm runs workspace scripts from apps/api; the old project sits next to the repo.
const folder = path.resolve(
  values.from ?? path.join(import.meta.dirname, '../../../../../MMSCRM_V2.0-main'),
);

const ICONS: Record<ReportLine['action'], string> = {
  create: '+ create ',
  update: '~ update ',
  merge: '» merge  ',
  skip: '= skip   ',
  'leave out': '- leave  ',
  problem: '! PROBLEM',
};

const db = createDb(requireDatabaseUrl('DATABASE_URL'));
try {
  const data = await loadLegacyData(folder);
  console.log(`Old CRM: ${folder}`);
  console.log(
    `Found ${String(data.contacts.length)} contacts, ${String(data.leads.length)} leads, ${String(data.projects.length)} projects.\n`,
  );
  const report = await migrateLegacy(db, data, {
    actorEmail: values.as,
    commit: values.commit,
    keepBoth: values['keep-both'],
    includeSuspect: values['include-suspect'],
  });
  for (const area of ['Contact', 'Lead', 'Project', 'Left out'] as const) {
    const lines = report.lines.filter((line) => line.area === area);
    if (!lines.length) continue;
    console.log(`── ${area === 'Left out' ? 'Not migrated' : `${area}s`} ${'─'.repeat(60)}`);
    for (const line of lines)
      console.log(`${ICONS[line.action]}  ${line.subject}\n             ${line.detail}`);
    console.log('');
  }
  const problems = report.lines.filter((line) => line.action === 'problem').length;
  console.log(
    report.committed
      ? `Done — saved.${problems ? ` ${String(problems)} problem(s) above were not saved.` : ''}`
      : `DRY RUN — nothing was saved.${problems ? ` ${String(problems)} problem(s) above.` : ''} Run again with --commit to save exactly this.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
