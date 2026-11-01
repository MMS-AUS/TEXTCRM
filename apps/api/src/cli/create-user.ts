import { parseArgs } from 'node:util';
import { createDb } from '../db/client.ts';
import { requireDatabaseUrl } from '../env.ts';
import { upsertUser } from '../users/upsert-user.ts';

// Usage: npm run user:create -w @mms/api -- --email you@makemysolar.com.au --name "Your Name" [--role admin]

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'admin' },
  },
});

const domain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
if (!values.email || !values.name || !domain) {
  console.error(
    'Usage: npm run user:create -w @mms/api -- --email you@makemysolar.com.au --name "Your Name" [--role admin]\n' +
      '(ALLOWED_EMAIL_DOMAIN must be set in .env)',
  );
  process.exit(1);
}

const db = createDb(requireDatabaseUrl('DATABASE_URL'));
try {
  const result = await upsertUser(
    db,
    { email: values.email, name: values.name, roleKey: values.role },
    domain,
  );
  console.log(
    `${result.created ? 'Created' : 'Updated and re-activated'} ${values.email} with role "${values.role}".`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
