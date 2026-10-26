import { Effect } from 'effect';
import { readBlockTree } from './layout.js';
import { readMarker } from './marker.js';
import { FORMAT_FILE } from '../contract/wire/storage.js';
import { join } from 'node:path';
import { BlockTreeUnreadable } from './layout.js';
import type { Validation } from './validation.js';

declare const self: Worker;

self.onmessage = async (event: MessageEvent<string>) => {
  const treeRoot = event.data;
  try {
    const result = await Effect.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const marker = yield* readMarker(join(treeRoot, FORMAT_FILE));
          if (marker.kind === 'unreadable' || marker.kind === 'unwritten')
            return yield* new BlockTreeUnreadable({ reason: 'file', path: join(treeRoot, FORMAT_FILE), message: marker.reason });
          const blocks = yield* readBlockTree(treeRoot);
          const ids = new Set<string>();
          for (const block of blocks) {
            if (ids.has(block.frontmatter.id))
              return yield* new BlockTreeUnreadable({
                reason: 'file',
                path: block.path,
                message: `duplicate block identity ${block.frontmatter.id}`,
              });
            ids.add(block.frontmatter.id);
          }
        }),
      ),
    );
    self.postMessage(
      result._tag === 'Success'
        ? ({ state: 'valid' } satisfies Validation)
        : ({
            state: 'invalid',
            reason: result.failure.reason,
            path: result.failure.path,
            message: result.failure.message,
          } satisfies Validation),
    );
  } catch (cause) {
    self.postMessage({ state: 'invalid', reason: 'io', path: treeRoot, message: String(cause) } satisfies Validation);
  }
};
self.postMessage({ state: 'ready' });
