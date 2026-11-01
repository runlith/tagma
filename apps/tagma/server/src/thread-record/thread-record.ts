import { Layer } from 'effect';
import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';

export const threadRecord = manifest({
  id: 'thread-record',
  tables: async () => {
    const [{ threadRecord }, { threadFolder }] = await Promise.all([import('./store/table.js'), import('./store/folders.js')]);
    return { entities: [threadFolder, threadRecord], history: [] };
  },
  rowFacts: async () => ({ rows: [(await import('./store/table.js')).recordRows.raw], selections: [] }),
  lifetimes: {
    installation: lazyLayer(
      () => Promise.all([import('./layer.js'), import('./folders.js')]),
      ([{ threadRecordsLayer }, { threadFoldersLayer }]) => Layer.merge(threadRecordsLayer, threadFoldersLayer),
    ),
  },
});
