import type { RowBirths } from '../../threads/contract/service/birth.js';
import type { NativeThreadRows } from './native.js';
import type { ThreadStore } from './threadRow.js';

export function rowBirths(store: ThreadStore, rows: NativeThreadRows): RowBirths {
  return {
    transaction: (work) => store.transaction(work),
    find: (id, unit) => store.find(id, unit),
    findNamed: (spawnRootId, ownerId, name, unit) => store.findNamed(spawnRootId, ownerId, name, unit),
    insert: (values, unit) => store.insert(values, unit),
    insertChild: (parentThreadId, values, unit) => store.insertChild(parentThreadId, values, unit),
    attachFacet: (facet, unit) => rows.attachFacet(facet, unit),
    inheritFacet: (facet, unit) => rows.inheritFacet(facet, unit),
  };
}
