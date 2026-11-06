import { sql, type SQL } from 'drizzle-orm';
import { customType, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

const parsedOrText = (stored: string): unknown => {
  try {
    return JSON.parse(stored);
  } catch {
    return stored;
  }
};

export const readableJson = customType<{ data: unknown; driverData: string }>({
  dataType: () => 'text',
  toDriver: (value) => JSON.stringify(value),
  fromDriver: parsedOrText,
});

type Stored = AnySQLiteColumn | SQL;

const pathOf = (path: `$.${string}`): SQL => sql.raw(`'${path.replaceAll("'", "''")}'`);

export const readableText = (stored: Stored): SQL => sql`(case when json_valid(${stored}) then ${stored} end)`;

export const readableField = (stored: Stored, path: `$.${string}`): SQL => sql`json_extract(${readableText(stored)}, ${pathOf(path)})`;

export const readableEdit = (stored: Stored, edit: (json: Stored) => SQL): SQL =>
  sql`case when json_valid(${stored}) then ${edit(stored)} else ${stored} end`;
