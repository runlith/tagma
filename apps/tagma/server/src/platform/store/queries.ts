import type { StoreBrand, StoreDb } from '../contract/service/store.js';

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
