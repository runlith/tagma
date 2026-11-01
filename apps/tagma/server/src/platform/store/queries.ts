import type { StoreBrand, StoreDb, StoreFailure } from '../contract/service/store.js';
import type { Unit } from '../contract/service/units.js';
import { fillPlaceholders } from 'drizzle-orm';
import type { PreparedQueryConfig } from 'drizzle-orm/sqlite-core/session';
import type { SQLiteEffectPreparedQuery } from 'drizzle-orm/sqlite-core/effect/session';
import type { QueryEffectHKTBase } from 'drizzle-orm/effect-core/query-effect';
import { programOf } from './programs.js';

export const bindQuery = <Config extends PreparedQueryConfig, HKT extends QueryEffectHKTBase>(
  query: SQLiteEffectPreparedQuery<Config, HKT>,
  values: Record<string, unknown>,
) => {
  const compiled = query.getQuery();
  return Object.assign(query.execute(values), {
    getQuery: () => ({ sql: compiled.sql, params: fillPlaceholders(compiled.params, values) }),
    rows: () => query.values(values),
  });
};

export const writePrepared = <
  Brand extends StoreBrand,
  Config extends PreparedQueryConfig,
  HKT extends QueryEffectHKTBase & { readonly error: StoreFailure; readonly context: never },
>(
  unit: Unit<Brand>,
  query: SQLiteEffectPreparedQuery<Config, HKT>,
  values: Record<string, unknown>,
  changes?: number,
) => {
  const program = programOf(unit);
  return program === null ? unit.run(query.execute(values)) : program.write(bindQuery(query, values), changes);
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
