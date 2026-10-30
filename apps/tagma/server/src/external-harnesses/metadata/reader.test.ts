import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as MemoryFileSystem from '@runlith/testbed/memory';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { dirname, join } from 'node:path';
import {
  MetadataInvalid,
  answered,
  emptyValues,
  fieldsOf,
  fileSource,
  jsonValue,
  metadataDecode,
  recordedValue,
  textOf,
  transcriptSaid,
  unsaid,
  type MetadataFold,
  type MetadataReader,
  type MetadataValues,
  type TranscriptWords,
} from '@runlith/tagma/adapter/metadata';
import { readTail } from '../ends/read.js';
import { fileLocationReader, MetadataFile } from './file.js';
import type { MetadataInput } from './input.js';
import { TRANSCRIPT_LIMITS } from './policy.js';
import { readRootArtifact } from './rootArtifact.js';
import { heardWords } from './words.js';

class Home extends Context.Service<Home, string>()('test/external-harnesses/metadata/ReaderHome') {}

const home = Layer.effect(
  Home,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    return yield* files.makeTempDirectoryScoped({ prefix: 'reader-' });
  }),
).pipe(Layer.provideMerge(MemoryFileSystem.layer));

const note = metadataDecode(Schema.Struct({ k: Schema.String, v: Schema.String }));

type Notes = MetadataValues & { readonly bound: boolean };

const notes = (rootKey: string): MetadataFold<Notes> => ({
  empty: () => ({ ...emptyValues(), bound: false }),
  line: (standing, text) => {
    const row = note(jsonValue(text));
    if (row.k === 'S') {
      if (row.v !== rootKey) throw new MetadataInvalid({ reason: 'identity' });
      return { ...standing, bound: true };
    }
    return row.k === 'M' ? { ...standing, model: recordedValue(row.v) } : standing;
  },
});

const spoken: MetadataFold<TranscriptWords> = {
  empty: unsaid,
  line: (standing, text) => {
    const row = note(jsonValue(text));
    const said = row.k === 'U' ? transcriptSaid(row.v, undefined) : null;
    return said === null ? standing : { ...standing, said: [...standing.said, said] };
  },
};

const ledger: MetadataReader = {
  sources: (input) => [
    fileSource(input.transcriptPath === undefined ? null : dirname(input.transcriptPath), input.transcriptPath, notes(input.rootKey), [
      'model',
    ]),
  ],
  provenance: { model: { source: 'transcript', readable: true }, effort: null, title: null },
  words: {
    sources: (input) => [
      { root: input.transcriptPath === undefined ? null : dirname(input.transcriptPath), path: input.transcriptPath, fold: spoken },
    ],
    usage: false,
  },
  ends: {
    reader: {
      shape: 'lines',
      window: 'offset',
      grain: 1,
      stampOf: () => null,
      judge: (newestFirst) => {
        for (const record of newestFirst) {
          const row = fieldsOf(record);
          if (row?.k === 'U') return { _tag: 'Open' };
          if (row?.k === 'E') return row.v === 'abort' ? { _tag: 'Aborted' } : answered(textOf(row.v) ?? '');
        }
        return null;
      },
    },
    locate: (input) => (input.transcriptPath === undefined ? null : { root: dirname(input.transcriptPath), path: input.transcriptPath }),
    located: 'reported',
  },
  artifact: { fold: notes, scan: 'one-record' },
};

const line = (k: string, v: string) => `${JSON.stringify({ k, v })}\n`;

layer(home)('a metadata reader shaped unlike every builtin', (it) => {
  it.effect('is read through the owners for sources, words, ends and the root artifact', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const path = join(yield* Home, 'ledger.jsonl');
      yield* files.writeFileString(path, line('S', 'root-1') + line('M', 'ledger-2') + line('U', 'say it again') + line('E', 'all done'));
      const input: MetadataInput = {
        rootKey: 'root-1',
        cwd: '/work/project',
        execution: { execution: 'exec-1', incarnation: 1 },
        storage: { binding: {} as MetadataInput['storage']['binding'], entries: [] },
        transcriptPath: path,
      };

      const [location] = ledger.sources(input);
      if (location === undefined || location.kind !== 'file') return yield* Effect.die(new Error('the ledger declares no file source'));
      expect(yield* fileLocationReader(location)(files)).toMatchObject({
        _tag: 'Read',
        complete: true,
        value: { model: { value: 'ledger-2', claim: 'last-recorded' } },
      });

      const [heard] = ledger.words?.sources(input) ?? [];
      if (heard?.root == null || heard.path === undefined) return yield* Effect.die(new Error('the ledger declares no word source'));
      const page = yield* new MetadataFile(heard.fold, TRANSCRIPT_LIMITS).read(files, heard.root, heard.path);
      expect(page._tag === 'Read' ? heardWords(page.value).words : null).toEqual(['say it again']);

      expect(yield* readTail(files, ledger.ends!, input, { since: 0, offset: 0, turn: null })).toEqual({
        _tag: 'Read',
        end: { _tag: 'Completed', message: 'all done' },
      });

      expect(yield* readRootArtifact(files, ledger, 'root-1', path)).toEqual({ _tag: 'Bound' });
      expect((yield* readRootArtifact(files, ledger, 'another-root', path))._tag).toBe('Refused');
    }),
  );
});
