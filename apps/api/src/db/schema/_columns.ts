import { sql, type AnyColumn } from 'drizzle-orm';
import { date, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

// Column names are camelCase here and snake_case in Postgres (casing: 'snake_case' in client + drizzle.config).

export const id = () => uuid().primaryKey().defaultRandom();

export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const tstz = () => timestamp({ withTimezone: true });

/** Calendar date without time, as 'YYYY-MM-DD' strings (no timezone shifting). */
export const day = () => date({ mode: 'string' });

/** AUD amounts. Returned as strings by the driver to keep cents exact. */
export const money = () => numeric({ precision: 12, scale: 2 });

/** Emails are stored trimmed and lower-cased (§1.4 duplicate rules). */
export const lowercaseEmailCheck = (column: AnyColumn) => sql`${column} = lower(btrim(${column}))`;

/** A basic shape check (something@domain.tld); the app's zod schema validates more strictly. */
export const emailFormatCheck = (column: AnyColumn) =>
  sql`${column} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`;

/** Phone numbers are stored normalised to E.164, e.g. +61412345678 (§1.4 duplicate rules). */
export const e164Check = (column: AnyColumn) => sql`${column} ~ '^\\+[1-9][0-9]{6,14}$'`;
