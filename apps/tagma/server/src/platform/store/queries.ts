import type { StoreBrand, StoreDb } from '../contract/service/store.js';
import { fillPlaceholders } from 'drizzle-orm';
import type { PreparedQueryConfig } from 'drizzle-orm/sqlite-core/session';
import type { SQLiteEffectPreparedQuery } from 'drizzle-orm/sqlite-core/effect/session';
import type { QueryEffectHKTBase } from 'drizzle-orm/effect-core/query-effect';

export const bindQuery = <Config extends PreparedQueryConfig, HKT extends QueryEffectHKTBase>(
  query: SQLiteEffectPreparedQuery<Config, HKT>,
  values: Record<string, unknown>,
) => {
  const compiled = query.getQuery();
  return Object.assign(query.execute(values), {
    getQuery: () => ({ sql: compiled.sql, params: fillPlaceholders(compiled.params, values) }),
  });
};

export const prepareFor = <Brand extends StoreBrand, Queries extends object>(compile: (db: StoreDb<Brand>) => Queries) => {
  const prepared = new WeakMap<StoreDb<Brand>, Queries>();
  return (db: StoreDb<Brand>): Queries => {
    const known = prepared.get(db);
    if (known !== undefined) return known;
    const queries = compile(db);
    prepared.set(db, queries);
    return queries;
  };
};
