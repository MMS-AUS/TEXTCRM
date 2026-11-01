/** For CLI scripts (migrate, seed, reset) that only need a database URL. The server uses config.ts. */
export function requireDatabaseUrl(name: 'DATABASE_URL' | 'DATABASE_URL_TEST'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env in the repo root.`);
  }
  return value;
}
