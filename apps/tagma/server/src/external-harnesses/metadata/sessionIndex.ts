import { Effect, FileSystem } from 'effect';
import { declare } from '@runlith/held/Held';
import { MetadataFile, type MetadataLimits, type MetadataPage } from './file.js';

type Entry = {
  readonly rows: Map<string, { users: number; title: string | null }>;
  cursor: MetadataFile<null>;
  reset: boolean;
};

const indexHeld = declare<string>({
  name: 'external-harnesses/metadata-session-index',
  owner: 'external-harnesses',
  rank: 420,
  key: (key) => key,
  concurrency: 1,
  threshold: '30 seconds',
  ceilings: {
    hold: '1 minute',
    wait: '1 minute',
    leaves: 'a cut index read stops where it stood; its cursor keeps the last line it parsed and the next reader continues from there',
  },
  external: { named: "a read of the CLI's session index file", callsBack: false },
});

export class MetadataIndex {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly limits: MetadataLimits) {}

  watch(namespace: string, root: string, path: string, id: string, parse: (text: string) => { id: string; title: string | null }) {
    const { entries } = this;
    const cursorOf = (rows: Entry['rows']) => this.cursor(rows, parse);
    return Effect.acquireRelease(
      Effect.uninterruptible(
        Effect.gen(function* () {
          const key = JSON.stringify([namespace, root, path]);
          let entry = entries.get(key);
          if (entry === undefined) {
            const rows: Entry['rows'] = new Map();
            entry = { rows, reset: false, cursor: cursorOf(rows) };
            entries.set(key, entry);
          }
          const row = entry.rows.get(id);
          if (row === undefined) {
            entry.rows.set(id, { users: 1, title: null });
            entry.reset = true;
          } else row.users++;
          const held = entry;
          return {
            key,
            id,
            entry: held,
            read: (files: FileSystem.FileSystem): Effect.Effect<MetadataPage<string | null>> =>
              indexHeld
                .hold(
                  key,
                  Effect.gen(function* () {
                    if (held.reset) {
                      held.cursor = cursorOf(held.rows);
                      held.reset = false;
                    }
                    const page = yield* held.cursor.read(files, root, path);
                    return page._tag === 'Read' ? { ...page, value: held.rows.get(id)?.title ?? null } : page;
                  }),
                )
                .pipe(
                  Effect.catchTags({
                    HoldStalled: () => Effect.succeed<MetadataPage<string | null>>({ _tag: 'Unreadable', reason: 'index-busy' }),
                    HoldCut: () => Effect.succeed<MetadataPage<string | null>>({ _tag: 'Unreadable', reason: 'index-cut' }),
                  }),
                  Effect.withSpan('HarnessMetadata.index'),
                ),
          };
        }),
      ),
      (held) =>
        Effect.sync(() => {
          const row = held.entry.rows.get(held.id);
          if (row !== undefined && --row.users === 0) held.entry.rows.delete(held.id);
          if (held.entry.rows.size === 0 && entries.get(held.key) === held.entry) entries.delete(held.key);
        }),
    );
  }

  private cursor(rows: Entry['rows'], parse: (text: string) => { id: string; title: string | null }): MetadataFile<null> {
    return new MetadataFile(
      {
        empty: () => {
          for (const row of rows.values()) row.title = null;
          return null;
        },
        line: (_, text) => {
          const read = parse(text);
          const row = rows.get(read.id);
          if (row !== undefined) row.title = read.title;
          return null;
        },
      },
      this.limits,
    );
  }
}
