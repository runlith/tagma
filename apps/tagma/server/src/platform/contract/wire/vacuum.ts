export type StoreSize = { readonly pages: number; readonly freePages: number; readonly pageSize: number };

export type Vacuum = {
  readonly before: StoreSize;
  readonly after: StoreSize;
  readonly pagesReturned: number;
  readonly heldMs: number;
};

export type VacuumDeclined =
  | { readonly outcome: 'disk-short'; readonly fileBytes: number; readonly freeBytes: number }
  | { readonly outcome: 'no-file' };

export type VacuumVerdict = { readonly outcome: 'vacuumed'; readonly vacuum: Vacuum } | VacuumDeclined;
