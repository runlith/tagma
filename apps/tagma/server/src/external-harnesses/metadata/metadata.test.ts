import { expect, test } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as MemoryFileSystem from '@runlith/testbed/memory';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { join } from 'node:path';
import { MetadataInvalid, emptyValues, fileSource } from '@runlith/tagma/adapter/metadata';
import { MetadataFile, fileLocationReader } from './file.js';
import { claude, claudeSources } from '../vendors/claude-code/metadata.js';
import { codex, codexIndex, codexRolloutName, codexSources } from '../vendors/codex/metadata.js';
import { cursorSources } from '../vendors/cursor/metadata.js';
import { MetadataIndex } from './sessionIndex.js';
import { metadataField } from './fields.js';
import { METADATA_LIMITS } from './policy.js';
import type { MetadataInput } from './input.js';
import { devin, devinTitle } from '../vendors/devin/metadata.js';
import { grok } from '@runlith/adapter-xai/harness';
import { NamespaceId } from '@runlith/files/namespace';
import { EnvironmentId } from '../../workspace/contract/wire/environments.js';
import type { HarnessStorage } from '../../threads/contract/wire/harness/session.js';

class Home extends Context.Service<Home, string>()('test/external-harnesses/metadata/MetadataHome') {}

const home = Layer.effect(
  Home,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    return yield* files.makeTempDirectoryScoped({ prefix: 'metadata-' });
  }),
).pipe(Layer.provideMerge(MemoryFileSystem.layer));

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const assistant = (sessionId: string, model: string) => line({ type: 'assistant', sessionId, message: { model } });

layer(home)('vendor metadata', (it) => {
  it.effect('two same-cwd Claude sessions keep exact identities through append, rotation and truncation', () =>
    Effect.gen(function* () {
      const root = yield* Home;
      const files = yield* FileSystem.FileSystem;
      const first = assistant('one', 'claude-fable-5-1');
      const second = assistant('two', 'claude-opus-5');
      const limits = {
        bytes: new TextEncoder().encode(first + second).length,
        records: 2,
        recordBytes: new TextEncoder().encode(first + second).length,
      };
      const one = new MetadataFile(claude('one'), limits);
      const two = new MetadataFile(claude('two'), limits);
      const path = join(root, 'one.jsonl');
      const peer = join(root, 'two.jsonl');
      yield* files.writeFileString(path, first);
      yield* files.writeFileString(peer, second);
      expect(yield* one.read(files, root, path)).toMatchObject({
        _tag: 'Read',
        complete: true,
        value: { model: { value: 'claude-fable-5-1', claim: 'last-recorded' } },
      });
      expect(yield* two.read(files, root, peer)).toMatchObject({
        _tag: 'Read',
        complete: true,
        value: { model: { value: 'claude-opus-5' } },
      });
      expect(yield* one.read(files, root, path)).toMatchObject({ _tag: 'Read', bytes: 0, records: 0 });
      const title = line({ type: 'ai-title', sessionId: 'one', aiTitle: 'Measured title' });
      yield* files.writeFileString(path, title, { flag: 'a' });
      expect(yield* one.read(files, root, path)).toMatchObject({
        _tag: 'Read',
        bytes: new TextEncoder().encode(title).length,
        value: { title: { value: 'Measured title' } },
      });
      yield* files.rename(path, `${path}.old`);
      yield* files.writeFileString(path, assistant('one', 'replacement'));
      expect(yield* one.read(files, root, path)).toMatchObject({ _tag: 'Read', value: { model: { value: 'replacement' }, title: null } });
      yield* files.writeFileString(path, '');
      expect(yield* one.read(files, root, path)).toMatchObject({ _tag: 'Read', value: { model: null, title: null } });
      yield* files.writeFileString(path, second);
      expect(yield* one.read(files, root, path)).toEqual({ _tag: 'Unreadable', reason: 'identity' });
    }),
  );

  it.effect('partial UTF-8 JSONL waits for a complete line and record limits do not reread the remaining bytes', () =>
    Effect.gen(function* () {
      const root = yield* Home;
      const files = yield* FileSystem.FileSystem;
      const first = line({ type: 'ai-title', sessionId: 'split', aiTitle: 'Привет' });
      const second = assistant('split', 'claude-opus-5');
      const bytes = new TextEncoder().encode(first);
      const split = bytes.indexOf(0xd0) + 1;
      const path = join(root, 'split.jsonl');
      const reader = new MetadataFile(claude('split'), {
        bytes: bytes.length + second.length,
        records: 1,
        recordBytes: bytes.length + second.length,
      });
      yield* files.writeFile(path, bytes.slice(0, split));
      expect(yield* reader.read(files, root, path)).toMatchObject({ _tag: 'Read', complete: false, value: { title: null } });
      yield* files.writeFile(path, bytes.slice(split), { flag: 'a' });
      yield* files.writeFileString(path, second, { flag: 'a' });
      expect(yield* reader.read(files, root, path)).toMatchObject({
        _tag: 'Read',
        complete: false,
        records: 1,
        value: { title: { value: 'Привет' }, model: null },
      });
      expect(yield* reader.read(files, root, path)).toMatchObject({
        _tag: 'Read',
        complete: true,
        bytes: 0,
        records: 1,
        value: { model: { value: 'claude-opus-5' } },
      });
    }),
  );

  it.effect('absent, malformed, escaped and over-limit files remain different answers', () =>
    Effect.gen(function* () {
      const root = yield* Home;
      const files = yield* FileSystem.FileSystem;
      const text = assistant('limits', 'claude-opus-5');
      const reader = () => new MetadataFile(claude('limits'), { bytes: text.length, records: 1, recordBytes: text.length - 2 });
      const path = join(root, 'limits.jsonl');
      expect(yield* reader().read(files, root, path)).toEqual({ _tag: 'Absent' });
      yield* files.writeFileString(path, '{bad}\n');
      expect(yield* reader().read(files, root, path)).toEqual({ _tag: 'Unreadable', reason: 'malformed' });
      yield* files.writeFileString(path, text);
      expect(yield* reader().read(files, root, path)).toMatchObject({
        _tag: 'Read',
        complete: true,
        records: 0,
        skipped: 1,
        missed: { model: 1, effort: 1 },
        value: { model: null },
      });
      const document = join(root, 'limits.json');
      yield* files.writeFileString(
        document,
        JSON.stringify({
          schema_version: 'ATIF-v1.7',
          session_id: 'clumsy-tower',
          agent: { model_name: 'SWE-2 Max' },
          steps: ['x'.repeat(200)],
        }),
      );
      const whole = new MetadataFile<ReturnType<typeof devin>>(
        { json: true, empty: () => ({ model: null, effort: null, title: null }), line: (_, value) => devin('clumsy-tower', value) },
        { bytes: 512, records: 1, recordBytes: 128 },
      );
      expect(yield* whole.read(files, root, document)).toEqual({ _tag: 'Unreadable', reason: 'limit' });
      const permitted = join(root, 'permitted');
      yield* files.makeDirectory(permitted);
      const escaped = join(permitted, 'escaped.jsonl');
      yield* files.symlink(path, escaped);
      expect(yield* reader().read(files, permitted, escaped)).toEqual({ _tag: 'Unreadable', reason: 'path' });
    }),
  );

  it.effect('an oversized transcript record is stepped over and its session still reads model and title', () =>
    Effect.gen(function* () {
      const root = yield* Home;
      const files = yield* FileSystem.FileSystem;
      const path = join(root, 'snapshots.jsonl');
      const snapshot = line({
        type: 'attachment',
        sessionId: 'snapshots',
        attachment: { type: 'prompt_snapshot', content: 'x'.repeat(185 * 1024) },
      });
      const title = line({ type: 'ai-title', sessionId: 'snapshots', aiTitle: 'Tagma harness acceptance probe' });
      yield* files.writeFileString(path, snapshot + title + snapshot + assistant('snapshots', 'claude-sonnet-5'));
      const reader = new MetadataFile(claude('snapshots'), METADATA_LIMITS);
      let page = yield* reader.read(files, root, path);
      while (page._tag === 'Read' && !page.complete) page = yield* reader.read(files, root, path);
      expect(page).toMatchObject({
        _tag: 'Read',
        complete: true,
        skipped: 2,
        missed: {},
        value: { model: { value: 'claude-sonnet-5' }, title: { value: 'Tagma harness acceptance probe' } },
      });
    }),
  );

  it.effect('a skip counts only against the fields its record could have carried', () =>
    Effect.gen(function* () {
      const root = yield* Home;
      const files = yield* FileSystem.FileSystem;
      const path = join(root, 'only-snapshot.jsonl');
      const snapshot = `${JSON.stringify({ parentUuid: 'p', isSidechain: false, attachment: { type: 'prompt_snapshot', content: 'x'.repeat(4 * 1024) }, type: 'attachment', sessionId: 'only' })}\n`;
      const sidechain = `${JSON.stringify({ parentUuid: 'p', isSidechain: true, message: { model: 'claude-sonnet-5', content: 'y'.repeat(4 * 1024) }, type: 'assistant', sessionId: 'only' })}\n`;
      yield* files.writeFileString(path, snapshot + sidechain);
      const reader = new MetadataFile(claude('only'), { bytes: 1024, records: 64, recordBytes: 2048 });
      let page = yield* reader.read(files, root, path);
      while (page._tag === 'Read' && !page.complete) page = yield* reader.read(files, root, path);
      expect(page).toMatchObject({ _tag: 'Read', complete: true, skipped: 2, missed: {}, value: { model: null, title: null } });
      const observedAt = '2026-09-15T11:00:00.000Z';
      const missed = page._tag === 'Read' ? page.missed : undefined;
      const count = (name: 'model' | 'effort' | 'title') => (missed === undefined ? 2 : (missed[name] ?? 0));
      expect(metadataField(null, 'transcript', 'only', observedAt, count('model'))).toMatchObject({ _tag: 'Absent' });
      expect(metadataField(null, 'transcript', 'only', observedAt, count('effort'))).toMatchObject({ _tag: 'Absent' });
      expect(metadataField(null, 'transcript', 'only', observedAt, count('title'))).toMatchObject({ _tag: 'Absent' });
    }),
  );

  it.effect('a field a reading skipped records for is a failed read, never an unset one', () =>
    Effect.gen(function* () {
      const root = yield* Home;
      const files = yield* FileSystem.FileSystem;
      const path = join(root, 'only-assistant.jsonl');
      const assistant = `${JSON.stringify({ parentUuid: 'p', isSidechain: false, message: { model: 'claude-sonnet-5', content: 'x'.repeat(4 * 1024) }, type: 'assistant', sessionId: 'only' })}\n`;
      yield* files.writeFileString(path, assistant);
      const reader = new MetadataFile(claude('only'), { bytes: 1024, records: 64, recordBytes: 2048 });
      let page = yield* reader.read(files, root, path);
      while (page._tag === 'Read' && !page.complete) page = yield* reader.read(files, root, path);
      expect(page).toMatchObject({ _tag: 'Read', complete: true, skipped: 1, missed: { model: 1, effort: 1 }, value: { model: null } });
      const observedAt = '2026-09-15T11:00:00.000Z';
      const missed = page._tag === 'Read' ? page.missed : undefined;
      const count = (name: 'model' | 'effort' | 'title') => (missed === undefined ? 1 : (missed[name] ?? 0));
      expect(metadataField(null, 'transcript', 'only', observedAt, count('model'))).toMatchObject({
        _tag: 'Unreadable',
        reason: 'records-past-limit:1',
      });
      expect(metadataField(null, 'transcript', 'only', observedAt, count('effort'))).toMatchObject({
        _tag: 'Unreadable',
        reason: 'records-past-limit:1',
      });
      expect(metadataField(null, 'transcript', 'only', observedAt, count('title'))).toMatchObject({ _tag: 'Absent' });
      expect(metadataField(null, 'transcript', 'only', observedAt)).toMatchObject({ _tag: 'Absent' });
    }),
  );

  test('Codex recorded effort and titles join exact ids without inventing missing effort', () => {
    const reader = codex('codex-one');
    let value = reader.line(reader.empty(), line({ type: 'session_meta', payload: { id: 'codex-one', session_id: 'codex-one' } }));
    value = reader.line(value, line({ type: 'turn_context', payload: { turn_id: 'turn-one', model: 'gpt-5.6-luna', effort: 'low' } }));
    expect(value).toMatchObject({
      model: { value: 'gpt-5.6-luna', turnId: 'turn-one', claim: 'last-recorded' },
      effort: { value: 'low', turnId: 'turn-one' },
    });
    value = reader.line(value, line({ type: 'turn_context', payload: { turn_id: 'turn-two', model: 'gpt-5.6-luna' } }));
    expect(value.effort).toBeNull();
    expect(() => reader.line(reader.empty(), line({ type: 'session_meta', payload: { id: 'codex-two' } }))).toThrow(MetadataInvalid);
    expect(codexIndex(line({ id: 'codex-one', thread_name: 'One' }))).toEqual({ id: 'codex-one', title: 'One' });
  });

  it.effect('a skipped codex envelope counts only when it could have carried model or effort', () =>
    Effect.gen(function* () {
      const root = yield* Home;
      const files = yield* FileSystem.FileSystem;
      const limits = { bytes: 1024, records: 64, recordBytes: 2048 };
      const envelope = (type: string, payload: unknown) =>
        `${JSON.stringify({ timestamp: '2026-07-04T15:23:22.553Z', ordinal: 4, type, payload })}\n`;
      const compacted = join(root, 'compacted.jsonl');
      yield* files.writeFileString(
        compacted,
        envelope('session_meta', { id: 'codex-skip' }) + envelope('compacted', { summary: 'x'.repeat(4 * 1024) }),
      );
      const ignored = new MetadataFile(codex('codex-skip'), limits);
      let page = yield* ignored.read(files, root, compacted);
      while (page._tag === 'Read' && !page.complete) page = yield* ignored.read(files, root, compacted);
      expect(page).toMatchObject({ _tag: 'Read', complete: true, skipped: 1, missed: {}, value: { model: null, effort: null } });
      const turn = join(root, 'turn-skip.jsonl');
      yield* files.writeFileString(
        turn,
        envelope('session_meta', { id: 'codex-turn' }) +
          envelope('turn_context', { turn_id: 't', model: 'gpt-5.6', notes: 'x'.repeat(4 * 1024) }),
      );
      const relevant = new MetadataFile(codex('codex-turn'), limits);
      let turned = yield* relevant.read(files, root, turn);
      while (turned._tag === 'Read' && !turned.complete) turned = yield* relevant.read(files, root, turn);
      expect(turned).toMatchObject({
        _tag: 'Read',
        complete: true,
        skipped: 1,
        missed: { model: 1, effort: 1 },
        value: { model: null, effort: null },
      });
    }),
  );

  it.effect('one host/home index shares initial and append work and releases its cache with its readers', () =>
    Effect.gen(function* () {
      const root = yield* Home;
      const files = yield* FileSystem.FileSystem;
      const path = join(root, 'session_index.jsonl');
      const initial = line({ id: 'one', thread_name: 'One' }) + line({ id: 'two', thread_name: 'Two' });
      yield* files.writeFileString(path, initial);
      const index = new MetadataIndex(METADATA_LIMITS);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const one = yield* index.watch('host-one', root, path, 'one', codexIndex);
          const two = yield* index.watch('host-one', root, path, 'two', codexIndex);
          expect(yield* one.read(files)).toMatchObject({ _tag: 'Read', value: 'One', bytes: initial.length });
          expect(yield* two.read(files)).toMatchObject({ _tag: 'Read', value: 'Two', bytes: 0, records: 0 });
          const appended = line({ id: 'two', thread_name: 'New two' });
          yield* files.writeFileString(path, appended, { flag: 'a' });
          expect(yield* one.read(files)).toMatchObject({ _tag: 'Read', value: 'One', bytes: appended.length });
          expect(yield* two.read(files)).toMatchObject({ _tag: 'Read', value: 'New two', bytes: 0 });
          const elsewhere = yield* index.watch('host-two', root, path, 'two', codexIndex);
          expect(yield* elsewhere.read(files)).toMatchObject({ _tag: 'Read', value: 'New two', bytes: initial.length + appended.length });
        }),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const reopened = yield* index.watch('host-one', root, path, 'one', codexIndex);
          const read = yield* reopened.read(files);
          expect(read._tag === 'Read' ? read.bytes : 0).toBeGreaterThan(0);
        }),
      );
    }),
  );

  it.effect('a document spanning the measured export budget is parsed once and then read without its bytes', () =>
    Effect.gen(function* () {
      const root = yield* Home;
      const files = yield* FileSystem.FileSystem;
      const path = join(root, 'session.json');
      const text = JSON.stringify({
        schema_version: 'ATIF-v1.7',
        session_id: 'clumsy-tower',
        agent: { model_name: 'SWE-2 Max' },
        steps: ['x'.repeat(107 * 1024)],
      });
      yield* files.writeFileString(path, text);
      const reader = new MetadataFile<ReturnType<typeof devin>>(
        { json: true, empty: () => ({ model: null, effort: null, title: null }), line: (_, value) => devin('clumsy-tower', value) },
        METADATA_LIMITS,
      );
      expect(yield* reader.read(files, root, path)).toMatchObject({
        _tag: 'Read',
        complete: false,
        bytes: METADATA_LIMITS.bytes,
        records: 0,
      });
      expect(yield* reader.read(files, root, path)).toMatchObject({
        _tag: 'Read',
        complete: true,
        bytes: text.length - METADATA_LIMITS.bytes,
        records: 1,
        value: { model: { value: 'SWE-2 Max', claim: 'last-recorded' } },
      });
      expect(yield* reader.read(files, root, path)).toMatchObject({ _tag: 'Read', complete: true, bytes: 0, records: 0 });
    }),
  );

  it.effect('a vendor document larger than one listing record is still read whole by its file source', () =>
    Effect.gen(function* () {
      const root = yield* Home;
      const files = yield* FileSystem.FileSystem;
      const path = join(root, 'grown-export.json');
      const text = JSON.stringify({
        schema_version: 'ATIF-v1.7',
        session_id: 'clumsy-tower',
        agent: { model_name: 'SWE-2 Max' },
        steps: [{ message: 'x'.repeat(135_000) }],
      });
      expect(text.length).toBeGreaterThan(METADATA_LIMITS.recordBytes);
      yield* files.writeFileString(path, text);
      const source = fileSource(
        root,
        path,
        {
          json: true,
          empty: emptyValues,
          line: (_, value) => devin('clumsy-tower', value),
        },
        ['model'],
      );
      if (source.kind !== 'file') return yield* Effect.die(new Error('the export path resolved to no file source'));
      const cursor = fileLocationReader(source);
      let page = yield* cursor(files);
      while (page._tag === 'Read' && !page.complete) page = yield* cursor(files);
      expect(page).toMatchObject({ _tag: 'Read', complete: true, value: { model: { value: 'SWE-2 Max', claim: 'last-recorded' } } });
    }),
  );

  test('Devin export/list preserve recorded claims and refuse foreign identities', () => {
    const atif = JSON.stringify({ schema_version: 'ATIF-v1.7', session_id: 'clumsy-tower', agent: { model_name: 'SWE-2 Max' } });
    expect(devin('clumsy-tower', atif).model).toMatchObject({ value: 'SWE-2 Max', claim: 'last-recorded' });
    expect(() => devin('other', atif)).toThrow(MetadataInvalid);
    expect(
      devinTitle(
        'clumsy-tower',
        JSON.stringify([
          { id: 'uuid-one', short_id: 'clumsy-tower', title: 'One' },
          { id: 'uuid-two', short_id: 'other', title: 'Two' },
        ]),
      )?.value,
    ).toBe('One');
    expect(() =>
      devinTitle(
        'clumsy-tower',
        JSON.stringify([
          { id: 'clumsy-tower', title: 'One' },
          { id: 'uuid-two', short_id: 'clumsy-tower', title: 'Two' },
        ]),
      ),
    ).toThrow(MetadataInvalid);
  });

  const testInput = (overrides: Partial<MetadataInput> & { rootKey: string }): MetadataInput => ({
    cwd: '/work/proj',
    execution: { execution: 'e-1', incarnation: 1 },
    storage: {
      binding: {
        environmentId: EnvironmentId.make('env-1'),
        kind: 'host',
        namespaceId: NamespaceId.make('ns-1'),
        identityWitness: { provider: 'test', format: 'test', token: 'witness-1' },
      },
      entries: [],
    } as HarnessStorage,
    ...overrides,
  });

  it.effect('Codex rollout names accept thread/revert files and refuse foreign sessions', () =>
    Effect.gen(function* () {
      const root = yield* Home;
      expect(codexRolloutName('rollout-2026-09-01T00-00-00-codex-one.jsonl', 'codex-one')).toBe(true);
      expect(codexRolloutName('rollout-2026-09-01T00-00-00-codex-one_0192abcd.jsonl', 'codex-one')).toBe(true);
      expect(codexRolloutName('rollout-2026-09-01T00-00-00-codex-two.jsonl', 'codex-one')).toBe(false);
      expect(codexRolloutName('rollout-2026-09-01T00-00-00-xcodex-one.jsonl', 'codex-one')).toBe(false);
      expect(codexRolloutName('rollout-2026-09-01T00-00-00-codex-one.txt', 'codex-one')).toBe(false);
      const home = { ...testInput({ rootKey: 'codex-one' }).storage, entries: [{ name: 'HOME' as const, value: root }] } as HarnessStorage;
      const revert = testInput({
        rootKey: 'codex-one',
        storage: home,
        transcriptPath: '/home/.codex/sessions/2026/09/01/rollout-2026-09-01T00-00-00-codex-one_0192abcd.jsonl',
      });
      expect(codexSources(revert)[1]).toMatchObject({ kind: 'file' });
      const foreign = testInput({
        rootKey: 'codex-one',
        storage: home,
        transcriptPath: '/home/.codex/sessions/2026/09/01/rollout-2026-09-01T00-00-00-codex-two.jsonl',
      });
      expect(codexSources(foreign)[1]).toMatchObject({ kind: 'unreadable', reason: 'session-identity-mismatch' });
    }),
  );

  test('Claude sidechain records never poison their session', () => {
    const reader = claude('one');
    const foreign = line({ type: 'assistant', sessionId: 'two', isSidechain: true, message: { model: 'claude-opus-5' } });
    expect(reader.line(reader.empty(), foreign)).toMatchObject({ model: null, title: null });
    const missing = line({ type: 'assistant', isSidechain: true, message: { model: 'claude-opus-5' } });
    expect(reader.line(reader.empty(), missing)).toMatchObject({ model: null, title: null });
  });

  test('Claude effort is the last recorded assistant effort, under the same rules as the model', () => {
    const reader = claude('effort-one');
    let value = reader.line(
      reader.empty(),
      line({ type: 'assistant', sessionId: 'effort-one', effort: 'low', message: { model: 'claude-haiku-4-5' } }),
    );
    expect(value).toMatchObject({ effort: { value: 'low', claim: 'last-recorded' }, model: { value: 'claude-haiku-4-5' } });
    value = reader.line(
      value,
      line({ type: 'assistant', sessionId: 'effort-one', effort: 'xhigh', message: { model: 'claude-sonnet-5' } }),
    );
    expect(value).toMatchObject({ effort: { value: 'xhigh' }, model: { value: 'claude-sonnet-5' } });
    value = reader.line(value, line({ type: 'assistant', sessionId: 'effort-one', message: { model: '<synthetic>' } }));
    expect(value).toMatchObject({ effort: { value: 'xhigh' }, model: { value: 'claude-sonnet-5' } });
    const sidechain = line({ type: 'assistant', sessionId: 'two', isSidechain: true, effort: 'max', message: { model: 'claude-opus-5' } });
    expect(reader.line(value, sidechain)).toMatchObject({ effort: { value: 'xhigh' } });
  });

  it.effect('Claude publishes effort from the transcript it reads, never as unsupported', () =>
    Effect.gen(function* () {
      const root = yield* Home;
      const home = { ...testInput({ rootKey: 'effort-src' }).storage, entries: [{ name: 'HOME' as const, value: root }] } as HarnessStorage;
      const input = testInput({ rootKey: 'effort-src', storage: home });
      expect(claudeSources(input)).toMatchObject([{ kind: 'file', source: 'transcript', fields: ['model', 'effort', 'title'] }]);
    }),
  );

  it.effect('a Grok session the locator cannot resolve reads unresolved, never unset', () =>
    Effect.gen(function* () {
      const root = yield* Home;
      const files = yield* FileSystem.FileSystem;
      const home = join(root, 'grok-home');
      yield* files.makeDirectory(join(home, 'sessions'), { recursive: true });
      const storage = {
        binding: testInput({ rootKey: 'grok-one' }).storage.binding,
        entries: [{ name: 'GROK_HOME' as const, value: home }],
      } as HarnessStorage;
      const input = testInput({ rootKey: 'grok-one', storage });
      const [summary] = grok.terminal!.metadata!.sources(input);
      if (summary === undefined || summary.kind !== 'file') return yield* Effect.die(new Error('expected a file source'));
      const read = fileLocationReader(summary);
      expect(yield* read(files)).toEqual({ _tag: 'Unreadable', reason: 'session-path-unresolved' });
      const dir = join(home, 'sessions', encodeURIComponent('/work/proj'), 'grok-one');
      yield* files.makeDirectory(dir, { recursive: true });
      yield* files.writeFileString(join(dir, 'summary.json'), JSON.stringify({ info: { id: 'grok-one' }, current_model_id: 'grok-4.6' }));
      expect(yield* read(files)).toMatchObject({ _tag: 'Read', value: { model: { value: 'grok-4.6' } } });
    }),
  );

  test('the Cursor title is read from the text frame, and a title the program never set is no value', () => {
    const input = testInput({ rootKey: 'cursor-title', execution: { execution: 'exec-1', incarnation: 0 } });
    const [title] = cursorSources(input);
    if (title === undefined || title.kind !== 'terminal') throw new Error('expected a terminal source');
    expect(title.cells).toBe(false);
    expect(title.parse({ title: 'Devin · my task' })).toEqual({
      value: 'Devin · my task',
      claim: 'last-recorded',
      turnId: null,
    });
    expect(title.parse({ title: '' })).toBeNull();
  });
});
