import { unthreadedCaller } from '../callers';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { ToolAnswer, ToolFailed, toolExecute, toolPrepare, toolSettleEffect } from '@runlith/agent/tool';
import { openToolDoor, ToolJudge } from '@runlith/agent/door/openToolDoor';
import { builtinMode } from '../modes.js';
import { createWriteTool } from '@runlith/agent-tools/write';
import { Effect, FileSystem } from 'effect';
import { toolOptions } from '@runlith/agent-tools/testing/options';
import { GraphTools, graphToolsFixture } from './graphTools.fixture.js';

layer(graphToolsFixture, { excludeTestServices: true })('native graph files', (it) => {
  it.effect('sourced notes are navigable through the graph doors while only explanations reach a session touching their code', () =>
    Effect.gen(function* () {
      const { demo, graph, root, ctx, nativeCall } = yield* GraphTools;
      const files = yield* FileSystem.FileSystem;
      const path = join(root, 'sourced-note.ts');
      yield* files.writeFileString(path, 'export const entry = 1;\n');
      const document = join(ctx.scratch.path, 'sourced-notes.json');
      yield* files.writeFileString(
        document,
        JSON.stringify({
          ops: [
            {
              op: 'create',
              title: 'A navigable note',
              sources: [
                { kind: 'file', ref: 'sourced-note.ts' },
                { kind: 'dir', ref: 'note-area' },
                { kind: 'symbol', ref: 'sourced-note.ts', symbol: 'entry' },
              ],
            },
          ],
        }),
      );
      const batched = yield* nativeCall('apply_batch', { file: document });
      expect(batched.status).toBe('ok');
      const born = yield* nativeCall('create_block', {
        title: 'A file note',
        body: 'Navigation without prompt delivery.',
        sources: [{ kind: 'file', ref: 'sourced-note.ts' }],
      });
      expect(born.status).toBe('ok');
      const name = (born.block as { name: string }).name;
      const owner = yield* nativeCall('read_owners', { path });
      expect(owner.overview as string).toContain(name);
      expect(yield* nativeCall('search_blocks', { path: 'sourced-note.ts', limit: 2 })).toMatchObject({ total: 2 });
      expect(yield* nativeCall('read_gauges', { path: 'sourced-note.ts', limit: 3 })).toMatchObject({ total: 3 });
      expect(yield* nativeCall('update_block', { blockId: name, tags: ['idea'] })).toMatchObject({ status: 'ok' });
      expect(yield* nativeCall('update_block', { blockId: name, tags: [] })).toMatchObject({ status: 'ok' });
      expect(yield* nativeCall('read_block', { blockIds: [name], depth: 0 })).toMatchObject({
        reads: [{ tags: [], sources: [{ kind: 'file', ref: 'sourced-note.ts' }] }],
      });
      const explanation = yield* nativeCall('create_block', {
        tags: ['explanation'],
        title: 'The entry remains stable',
        body: 'Consumers retain its identity.',
        sources: [{ kind: 'file', ref: 'sourced-note.ts' }],
      });
      expect(explanation.status).toBe('ok');
      for (const as of ['read', 'wrote'] as const) {
        const briefs = yield* demo.as('note-reader', graph.touches.touch({ projectId: ctx.projectId, shown: [{ path, as }] }));
        expect(briefs.map((brief) => brief.explanations.map((row) => row.name))).toEqual([[(explanation.block as { name: string }).name]]);
      }
    }),
  );

  it.effect('a body arrives as a file in the thread’s scratch, and the refusal names that file to edit', () =>
    Effect.gen(function* () {
      const { demo, graph, ctx, call, nativeCall } = yield* GraphTools;
      const files = yield* FileSystem.FileSystem;
      const scratchPath = ctx.scratch.path;
      yield* files.writeFileString(join(scratchPath, 'body.md'), 'A body the agent wrote as a file, with "quotes" and a\nnewline.');
      const born = (yield* call('create_block', { tags: ['idea'], title: 'Written from a file', bodyFile: 'body.md' })) as {
        block: { name: string };
      };
      expect((yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(born.block.name))).body).toBe(
        'A body the agent wrote as a file, with "quotes" and a\nnewline.',
      );

      yield* files.writeFileString(join(scratchPath, 'long.md'), 'x'.repeat(2000));
      const updated = yield* nativeCall('update_block', { blockId: born.block.name, bodyFile: 'long.md' });
      expect(updated).toMatchObject({ status: 'ok' });
      expect((yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(born.block.name))).body).toBe('x'.repeat(2000));
      expect(yield* nativeCall('update_block', { blockId: born.block.name, body: 'inline', bodyFile: 'long.md' })).toMatchObject({
        status: 'refused',
        code: 'body-source',
      });
      const missing = yield* nativeCall('create_block', { tags: ['idea'], title: 'no such body', bodyFile: 'absent.md' });
      expect(missing).toMatchObject({ status: 'refused', code: 'body-source' });
      expect(missing.reason as string).toContain(join(scratchPath, 'absent.md'));
    }),
  );

  it.effect('a recurring reflection is a child sighting and leaves the keeper body unchanged', () =>
    Effect.gen(function* () {
      const { demo, graph, nativeCall, call } = yield* GraphTools;
      const first = (yield* nativeCall('file_reflection', {
        title: 'Recurring door friction',
        command: 'first call',
        expected: 'one durable answer',
        actual: 'the first failure',
        body: 'The first filing owns this prose.',
      })) as { block: { name: string }; body: string[] };
      const keeperId = yield* graph.blockNames.idOfName(first.block.name);
      const keeperBody = (yield* graph.blocks.blockById(keeperId)).body;
      const repeated = (yield* nativeCall('file_reflection', {
        ontoId: first.block.name,
        title: 'Recurring door friction',
        command: 'second call',
        expected: 'another durable sighting',
        actual: 'the failure recurred',
        body: 'The second filing keeps its own prose.',
      })) as { block: { name: string }; body: string[]; sightings: number };
      expect(repeated.block.name).toBe(first.block.name);
      expect(repeated.sightings).toBe(2);
      expect((yield* graph.blocks.blockById(keeperId)).body).toBe(keeperBody);
      const home = yield* graph.sourceProject.project();
      if (home === undefined) return yield* Effect.die('the fixture has no reflection home');
      const page = yield* graph.selection.query(home.id, {
        tags: ['reflection'],
        includeResting: true,
        scope: [first.block.name],
        sort: { by: 'created', order: 'desc' },
      });
      expect(page.items).toHaveLength(2);
      const sightingName = page.items.find((row) => row.name !== first.block.name)?.name;
      if (sightingName === undefined) return yield* Effect.die('the recurring sighting did not land');
      const sighting = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(sightingName));
      expect(sighting.parentId).toBe(keeperId);
      expect(sighting.fields).toMatchObject({ command: 'second call', actual: 'the failure recurred' });
      type Listed = { blocks: { name: string; sightings: number }[]; total: number };
      const listed = (yield* call('read_reflections', {})) as Listed;
      expect(listed.blocks.find((row) => row.name === first.block.name)?.sightings).toBe(2);
      const fix = yield* graph.blocks.create({ projectId: home.id, tags: ['rule'], title: 'The failure is fixed.' });
      const by = yield* demo.nameOf(fix.id);
      expect(yield* call('answer_reflection', { blockId: first.block.name, by })).toMatchObject({ status: 'ok' });
      const promoted = (yield* call('read_reflections', {})) as Listed;
      expect(promoted.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ name: sightingName, sightings: 1 })]));
      expect(promoted.total).toBe(listed.total);
      expect(yield* call('unanswer_reflection', { blockId: first.block.name, by })).toMatchObject({ status: 'ok' });
      expect(yield* call('answer_reflection', { blockId: sightingName, by })).toMatchObject({ status: 'ok' });
      const regrouped = (yield* call('read_reflections', {})) as Listed;
      expect(regrouped.blocks.find((row) => row.name === first.block.name)?.sightings).toBe(1);
      expect(regrouped.total).toBe(listed.total);
      const recurred = (yield* nativeCall('file_reflection', {
        ontoId: first.block.name,
        title: 'Recurring door friction',
        command: 'third call',
        expected: 'one standing group',
        actual: 'another failure',
      })) as { block: { name: string }; sightings: number };
      expect(recurred.sightings).toBe(2);
      const afterFiling = (yield* call('read_reflections', {})) as Listed;
      expect(afterFiling.blocks.find((row) => row.name === first.block.name)?.sightings).toBe(recurred.sightings);
      const family = yield* graph.selection.query(home.id, {
        tags: ['reflection'],
        includeResting: true,
        scope: [first.block.name],
        sort: { by: 'created', order: 'desc' },
      });
      const latest = family.items.find((row) => row.name !== first.block.name && row.name !== sightingName)?.name;
      if (latest === undefined) return yield* Effect.die('the latest sighting did not land');
      expect(yield* call('answer_reflection', { blockId: first.block.name, by })).toMatchObject({ status: 'ok' });
      const nested = (yield* nativeCall('file_reflection', {
        ontoId: latest,
        title: 'Recurring door friction',
        command: 'fourth call',
        expected: 'one standing group',
        actual: 'still failing',
      })) as { block: { name: string }; sightings: number };
      expect(nested.block.name).toBe(latest);
      expect(nested.sightings).toBe(2);
      expect(yield* call('unanswer_reflection', { blockId: first.block.name, by })).toMatchObject({ status: 'ok' });
      const returned = (yield* call('read_reflections', {})) as Listed;
      expect(returned.blocks.find((row) => row.name === first.block.name)?.sightings).toBe(3);
      expect(returned.total).toBe(listed.total);
    }),
  );

  it.effect('a document named by a bare path is re-read from this thread’s scratch after refusal', () =>
    Effect.gen(function* () {
      const { graph, ctx, nativeCall } = yield* GraphTools;
      const files = yield* FileSystem.FileSystem;
      const document = join(ctx.scratch.path, 'document.json');
      const chapter = join(ctx.scratch.path, 'chapter.md');
      yield* files.writeFileString(chapter, 'The stale chapter.');
      yield* files.writeFileString(document, JSON.stringify({ ops: [{ op: 'create', $id: 'c', tags: ['idea'] }] }));
      const refused = yield* nativeCall('apply_batch', { file: 'document.json' });
      expect(refused).toMatchObject({ status: 'refused', code: 'bad-document', inputFile: document });
      yield* files.writeFileString(chapter, 'The chapter body, beside its document.');
      yield* files.writeFileString(
        document,
        JSON.stringify({ ops: [{ op: 'create', $id: 'c', tags: ['idea'], title: 'from the scratch', body: { file: 'chapter.md' } }] }),
      );
      const applied = yield* nativeCall('apply_batch', { file: 'document.json' });
      expect(applied.status).toBe('ok');
      const name = (applied.overview as string).match(/\$c → ([0-9a-f]+)/)?.[1];
      if (name === undefined) return yield* Effect.die('The document returned no handle.');
      expect((yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(name))).body).toBe('The chapter body, beside its document.');
    }),
  );

  it.effect('a nested scratch document written through the workspace door is readable by apply_batch immediately', () =>
    Effect.gen(function* () {
      const { ctx, nativeCall } = yield* GraphTools;
      const document = join(ctx.scratch.path, 'spec', 'land-b.json');
      const workspaceWrite = createWriteTool(toolOptions({ cwd: ctx.scratch.path }));
      yield* Effect.acquireUseRelease(
        Effect.sync(() => openToolDoor('run-native', unthreadedCaller, {}, new ToolJudge(builtinMode('trust')))),
        (door) =>
          door.settle({
            name: 'write',
            input: {
              path: document,
              content: JSON.stringify({ ops: [{ op: 'create', $id: 'first', tags: ['idea'], title: 'first nested absolute read' }] }),
            },
            tool: workspaceWrite,
            options: { toolCallId: 'call-workspace-write', messages: [] },
          }),
        (door) => door.close(),
      );
      const applied = yield* nativeCall('apply_batch', { file: document });
      expect(applied.status).toBe('ok');
      expect(applied.overview as string).toContain('$first →');
    }),
  );

  it.effect('a file a graph act reads is judged under the spelling a workspace write of that file carries', () =>
    Effect.gen(function* () {
      const { demo, graph, graphCatalog, ctx } = yield* GraphTools;
      const files = yield* FileSystem.FileSystem;
      const prepareWrite = toolPrepare(createWriteTool(toolOptions({ cwd: ctx.workingRoot, allowOutsideCwd: true })));
      if (prepareWrite === null) return yield* Effect.die('The workspace write resolves nothing before it is judged.');
      const readOf = Effect.fnUntraced(function* (path: string) {
        const [subject] = (yield* prepareWrite({ path, content: 'written' }, { toolCallId: 'call-write', caller: unthreadedCaller }))
          .subjects;
        if (subject === undefined) return yield* Effect.die(`The workspace write of ${path} declared nothing.`);
        return { kind: 'read' as const, value: subject.value, file: true as const };
      });
      const tools = yield* graphCatalog(ctx);
      const block = yield* graph.blocks.create({ projectId: ctx.projectId, tags: ['idea'], title: 'file input target' });
      const blockId = yield* demo.nameOf(block.id);
      const body = yield* readOf(join(ctx.scratch.path, 'notes', 'body.md'));
      const create = yield* toolPrepare(tools.create_block!)!(
        { title: 'from a file', bodyFile: 'notes/body.md' },
        { toolCallId: 'create-body', caller: unthreadedCaller },
      );
      const update = yield* toolPrepare(tools.update_block!)!(
        { blockId, bodyFile: 'notes/body.md' },
        { toolCallId: 'update-body', caller: unthreadedCaller },
      );
      expect(create.subjects).toContainEqual(body);
      expect(update.subjects).toContainEqual(body);
      yield* files.makeDirectory(join(ctx.scratch.path, 'notes'), { recursive: true });
      yield* files.writeFileString(
        join(ctx.scratch.path, 'notes', 'batch.json'),
        JSON.stringify({ ops: [{ op: 'create', title: 'from a file' }] }),
      );
      const batch = yield* toolPrepare(tools.apply_batch!)!(
        { file: 'notes/batch.json' },
        { toolCallId: 'batch-file', caller: unthreadedCaller },
      );
      expect(batch.subjects).toContainEqual(yield* readOf(join(ctx.scratch.path, 'notes', 'batch.json')));
      const inline = join(ctx.scratch.path, 'inline.md');
      const prepared = yield* toolPrepare(tools.apply_batch!)!(
        { ops: [{ op: 'create', title: 'absolute body', body: { file: inline } }] },
        { toolCallId: 'batch-body', caller: unthreadedCaller },
      );
      expect(prepared.subjects).toContainEqual(yield* readOf(inline));
    }),
  );

  it.effect('an unreadable batch source preserves its refusal code, path and filesystem condition', () =>
    Effect.gen(function* () {
      const { ctx, nativeCall } = yield* GraphTools;
      const missing = join(ctx.scratch.path, 'spec', 'missing.json');
      const failure = yield* Effect.flip(nativeCall('apply_batch', { file: missing }));
      const cause = failure.cause;
      if (!(cause instanceof ToolFailed)) return yield* Effect.die('the batch source failed without its tool refusal');
      expect(cause.code).toBe('batch-source');
      expect(cause.reason).toContain(missing);
      expect(cause.reason).toContain('NotFound');
    }),
  );

  it.effect('a refusal reaching the model spells operations in the names it calls them by', () =>
    Effect.gen(function* () {
      const { call } = yield* GraphTools;
      const born = (yield* call('create_block', { tags: ['idea'], title: 'Gone' })) as { block: { name: string } };
      yield* call('delete_block', { blockId: born.block.name });
      const refused = (yield* call('read_block', { blockIds: [born.block.name] })) as { status: string; code: string; unblock: string[] };
      expect(refused.status).toBe('refused');
      expect(refused.code).toBe('deleted');
      expect(refused.unblock.join(' ')).toContain(`restore_block ${born.block.name}`);
      expect(refused.unblock.join(' ')).not.toContain('tagma ');
      expect(refused.unblock.join(' ')).not.toContain(['{{', 'op:'].join(''));
    }),
  );

  it.effect('an MCP server declared natively is what the native read answers, and a second of its name is refused', () =>
    Effect.gen(function* () {
      const { call } = yield* GraphTools;
      const declared = (yield* call('add_mcp_server', {
        name: 'files',
        transport: 'stdio',
        command: 'echo',
        args: ['hello'],
        capabilities: { kinds: [], mutates: false },
      })) as { mcp: { name: string; reach: Record<string, unknown>; enabled: boolean; status: string }[] };
      expect(declared.mcp).toHaveLength(1);
      expect(declared.mcp[0]).toMatchObject({
        name: 'files',
        reach: { transport: 'stdio', command: 'echo', args: ['hello'], env: [] },
        enabled: true,
      });
      const read = (yield* call('read_mcp_servers', {})) as typeof declared;
      expect(read.mcp.map((row) => row.reach)).toEqual(declared.mcp.map((row) => row.reach));
      expect(read.mcp.map((row) => row.status)).not.toContain('pending');
      expect(['connecting', 'connected', 'failed']).toContain(String(read.mcp[0]?.status));
      const refused = yield* call('add_mcp_server', {
        name: 'files',
        transport: 'http',
        url: 'https://example.invalid/mcp',
        capabilities: { kinds: [], mutates: false },
      });
      expect(refused).toMatchObject({ status: 'refused', code: 'mcp-server-exists' });
      expect((yield* call('remove_mcp_server', { name: 'files' })).mcp).toEqual([]);
    }),
  );

  it.effect('a finding is filed and corrected one at a time, through the same gates a batch faces', () =>
    Effect.gen(function* () {
      const { call } = yield* GraphTools;
      const target = (yield* call('create_block', { tags: ['idea'], title: 'Under review' })) as { block: { name: string } };
      const filed = (yield* call('create_block', {
        tags: ['proposal'],
        title: 'The claim moved',
        amendsId: target.block.name,
        fields: { ops: [{ op: 'edit', id: target.block.name, old: 'Under review', new: 'Read' }] },
      })) as { status: string; block: { name: string; tags: readonly string[]; parentName: string } };
      expect(filed.status).toBe('ok');
      expect(filed.block.tags).toEqual(['proposal']);
      expect(filed.block.parentName).toBe(target.block.name);
      expect(
        yield* call('revise_amendment', { blockId: filed.block.name, ops: [{ op: 'update', id: target.block.name, title: 'Read' }] }),
      ).toMatchObject({ status: 'ok' });
      yield* call('reject_amendment', { blockId: filed.block.name, reason: 'the claim is right as it stands' });
      expect(
        yield* call('revise_amendment', { blockId: filed.block.name, ops: [{ op: 'update', id: target.block.name, title: 'Read' }] }),
      ).toMatchObject({ status: 'refused' });
    }),
  );

  it.effect(
    'a graph act settles from the journal after a death: landed with what it wrote, or aborted; an act the journal does not record reads nothing back from it',
    () =>
      Effect.gen(function* () {
        const { ctx, root, graphCatalog, call } = yield* GraphTools;
        const files = yield* FileSystem.FileSystem;
        const born = (yield* call('create_block', { tags: ['idea'], title: 'Measured' })) as { block: { name: string } };
        yield* files.writeFileString(join(root, 'settled.ts'), 'export const settled = 1;\n');
        const tools = yield* graphCatalog(ctx);
        const anchor = tools.anchor_block!;
        const execute = toolExecute(anchor)!;
        const anchorInput = { blockId: born.block.name, ref: 'settled.ts' };
        const prepared = yield* toolPrepare(anchor)!(anchorInput, { toolCallId: 'call-anchor-7', caller: unthreadedCaller });
        yield* execute(anchorInput, { toolCallId: 'call-anchor-7', caller: unthreadedCaller, messages: [], prepared: prepared.prepared });
        const settled = yield* toolSettleEffect(anchor, { toolCallId: 'call-anchor-7', caller: unthreadedCaller, toolInput: {} })!;
        expect(settled.status).toBe('completed');
        const recovered = (settled as { output: ToolAnswer }).output;
        const output = recovered.value as {
          status: string;
          landed: { at: string; acts: readonly { op: string; blockName: string | null }[] };
        };
        expect(output.status).toBe('ok');
        expect(output.landed.acts).toEqual([{ op: 'anchor', blockName: born.block.name }]);
        expect(Date.parse(output.landed.at)).toBeGreaterThan(0);
        expect(recovered.text).toContain(`anchor ${born.block.name}`);
        expect(yield* toolSettleEffect(anchor, { toolCallId: 'call-never-ran', caller: unthreadedCaller, toolInput: {} })!).toEqual({
          status: 'aborted',
        });
        const batch = (yield* toolExecute(tools.apply_batch!)!(
          {
            ops: [
              { op: 'create', tags: ['idea'], title: 'First of two', parentId: born.block.name },
              { op: 'create', tags: ['idea'], title: 'Second of two', parentId: born.block.name },
            ],
          },
          { toolCallId: 'call-batch-8', caller: unthreadedCaller, messages: [] },
        )) as ToolAnswer;
        expect((batch.value as { status: string }).status).toBe('ok');
        const twice = yield* toolSettleEffect(tools.apply_batch!, {
          toolCallId: 'call-batch-8',
          caller: unthreadedCaller,
          toolInput: {},
        })!;
        expect(twice.status).toBe('completed');
        const landed = ((twice as { output: ToolAnswer }).output.value as { landed: { acts: readonly { op: string }[] } }).landed;
        expect(landed.acts.map((act) => act.op)).toEqual(['create', 'create']);
        for (const name of ['write_setting', 'add_mcp_server', 'capture_performance_profile'])
          expect(toolSettleEffect(tools[name]!, { toolCallId: 'call-elsewhere', caller: unthreadedCaller, toolInput: {} })).toBeNull();
      }),
  );

  it.effect('a write names the journal range its call left, and that range opens on what it changed', () =>
    Effect.gen(function* () {
      const { graph, callAt } = yield* GraphTools;
      type Ranged = { block: { name: string }; journal?: { from: number; to: number; chars?: { from: number; to: number } } };
      const born = (yield* callAt('call-ranged-born', 'create_block', {
        tags: ['idea'],
        title: 'Measured against its own change',
        body: 'The first body.',
      })) as Ranged;
      expect(born.journal).toBeDefined();
      const edited = (yield* callAt('call-ranged-edit', 'edit_block', {
        blockId: born.block.name,
        oldString: 'first',
        newString: 'second',
      })) as Ranged;
      const range = edited.journal;
      if (range === undefined) return yield* Effect.die('the edit named no journal range');
      expect(range.from).toBeGreaterThanOrEqual(born.journal?.to ?? 0);
      expect(range.to).toBeGreaterThan(range.from);
      expect(range.chars?.to).toBe((range.chars?.from ?? 0) + 1);
      const blockId = yield* graph.blockNames.idOfName(born.block.name);
      const diff = yield* graph.history.blockDiff({ blockId, from: range.from, to: range.to });
      expect(diff.entries).toBe(1);
      expect(diff.body).toContain('second');
      expect(diff.body).toContain('<ins>');
      const read = yield* callAt('call-ranged-read', 'read_block', { blockIds: [born.block.name] });
      expect(read.journal).toBeUndefined();
    }),
  );
});
