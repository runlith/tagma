import { unthreadedCaller } from './testing/caller';
import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '@runlith/agent/tool';
import { ToolAnswer, ToolFailed, toolClaims, toolExecute, toolPrepare } from '@runlith/agent/tool';
import { Effect } from 'effect';
import { createTools } from './index';
import type { PreparedPath, WorkspaceBindings } from './workspace';
import { options } from './testing/toolHarness';

const NAME = 'config.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'runlith-prepared-')));

afterAll(() => {
  rmSync(home, { force: true, recursive: true });
});

function root(name: string, content: string): string {
  const at = join(home, name);
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, NAME), content);
  return at;
}

const A = root('root-a', 'a\n');
const B = root('root-b', 'b\n');

const held = (at: string): string => readFileSync(join(at, NAME), 'utf8');

const bindings = (base: string): WorkspaceBindings => ({
  of: (target, real) => (real === target ? `${base}\u0000${target}` : null),
});

const catalogAt = (at: string) => createTools(options({ cwd: at, allowOutsideCwd: true, bindings: bindings(at) }));

const inA = catalogAt(A);
const inB = catalogAt(B);

const preparationOf = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  const prepare = toolPrepare(tool);
  if (!prepare) return yield* Effect.die(new Error('The tool resolves nothing.'));
  return yield* prepare(input, { toolCallId: 'call-1', caller: unthreadedCaller });
});

const resolutionOf = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  return (yield* preparationOf(tool, input)).prepared;
});

const subjectsOf = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  return (yield* preparationOf(tool, input)).subjects;
});

const body = Effect.fnUntraced(function* (tool: Tool, input: unknown, prepared: unknown) {
  const execute = toolExecute(tool);
  if (!execute) return yield* Effect.die(new Error('The tool declares no execute.'));
  const settled = yield* (
    execute(input, { toolCallId: 'call-1', caller: unthreadedCaller, messages: [], prepared }) as Effect.Effect<unknown, ToolFailed>
  ).pipe(Effect.catch((failure) => Effect.succeed(failure.reason)));
  return String(settled instanceof ToolAnswer ? settled.value : settled);
});

it.effect('a write declares the file it names by its lexical value, whatever the embedding proves', () =>
  Effect.gen(function* () {
    const input = { path: NAME, content: 'x\n' };

    expect(yield* subjectsOf(inA.write, input)).toEqual([{ kind: 'write', value: NAME, file: true }]);
    expect(yield* subjectsOf(createTools(options({ cwd: A })).write, input)).toEqual([{ kind: 'write', value: NAME, file: true }]);
  }),
);

it.effect('one admitted write creates every missing parent and its file, without preparation creating anything', () =>
  Effect.gen(function* () {
    const input = { path: 'drizzle/new/deeper/migration.sql', content: 'CREATE TABLE sample (id INTEGER);\n' };
    const target = join(A, input.path);
    expect(yield* subjectsOf(inA.write, input)).toEqual([{ kind: 'write', value: input.path, file: true }]);
    const resolution = yield* resolutionOf(inA.write, input);
    const ask = inA.write.confirmation!.prepare as (input: unknown) => Effect.Effect<unknown, unknown>;
    yield* ask(input);
    expect(existsSync(join(A, 'drizzle'))).toBe(false);
    yield* body(inA.write, input, resolution);
    expect(readFileSync(target, 'utf8')).toBe(input.content);
  }),
);

it.effect('a missing descendant is judged over its physical ancestor and a changed ancestor refuses before creation', () =>
  Effect.gen(function* () {
    const link = join(home, 'parent-link');
    symlinkSync(A, link);
    const tools = createTools(options({ cwd: home, allowOutsideCwd: true, bindings: { of: (_target, real) => real } }));
    const input = { path: join(link, 'new-parent/child/copied.ts'), fromFile: join(A, NAME) };
    const content = held(A);
    const relative = 'new-parent/child/copied.ts';
    const subjects = yield* subjectsOf(tools.write, input);
    expect(subjects[0]).toEqual({ kind: 'write', value: `root-a/${relative}`, file: true });
    const resolution = yield* resolutionOf(tools.write, input);
    rmSync(link);
    symlinkSync(B, link);
    yield* body(tools.write, input, resolution);
    expect(existsSync(join(A, 'new-parent'))).toBe(false);
    expect(existsSync(join(B, 'new-parent'))).toBe(false);
    yield* body(tools.write, input, yield* resolutionOf(tools.write, input));
    expect(readFileSync(join(B, relative), 'utf8')).toBe(content);
  }),
);

it.effect('a resource write refuses a dangling link during preparation while entry deletion can remove it', () =>
  Effect.gen(function* () {
    const link = join(home, 'dangling');
    const missing = join(home, 'missing-target');
    symlinkSync(missing, link);
    const tools = createTools(options({ cwd: home, bindings: { of: (_target, real) => real } }));
    const result = yield* Effect.result(
      toolPrepare(tools.write)!({ path: link, content: 'new\n' }, { toolCallId: 'call-1', caller: unthreadedCaller }),
    );
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure).toBeInstanceOf(ToolFailed);
    expect(readlinkSync(link)).toBe(missing);
    expect(existsSync(missing)).toBe(false);
    const input = { args: [link], glob: false };
    yield* body(tools.delete, input, yield* resolutionOf(tools.delete, input));
    expect(readdirSync(home)).not.toContain('dangling');
  }),
);

it.effect('a source rewritten after the call was resolved refuses instead of landing', () =>
  Effect.gen(function* () {
    writeFileSync(join(A, 'shown.ts'), 'the bytes a person read\n');
    const input = { path: 'copied.ts', fromFile: 'shown.ts' };
    const resolution = yield* resolutionOf(inA.write, input);

    writeFileSync(join(A, 'shown.ts'), 'something else entirely\n');

    const refused = yield* body(inA.write, input, resolution);
    expect(refused).toContain('holds different bytes than the ones this call was allowed over');
    expect(existsSync(join(A, 'copied.ts'))).toBe(false);

    writeFileSync(join(A, 'shown.ts'), 'the bytes a person read\n');
    yield* body(inA.write, input, resolution);
    expect(readFileSync(join(A, 'copied.ts'), 'utf8')).toBe('the bytes a person read\n');
  }),
);

it.effect('an empty path argument refuses before anything is resolved or anyone is asked', () =>
  Effect.gen(function* () {
    for (const [tool, input] of [
      [inA.write, { path: '', content: 'x\n' }],
      [inA.edit, { path: '', oldString: 'a', newString: 'b' }],
      [inA.delete, { args: [''], glob: false }],
      [inA.rename, { from: '', to: 'somewhere.ts' }],
    ] as const) {
      const prepare = toolPrepare(tool!);
      if (!prepare) return yield* Effect.die(new Error('the tool resolves nothing.'));
      const refused = yield* Effect.flip(prepare(input, { toolCallId: 'call-1', caller: unthreadedCaller }));
      expect(refused).toBeInstanceOf(ToolFailed);
    }
  }),
);

it.effect('a write that copies declares the file it reads beside the file it writes', () =>
  Effect.gen(function* () {
    writeFileSync(join(A, 'source.ts'), 'from here\n');
    const copied = yield* subjectsOf(inA.write, { path: NAME, fromFile: 'source.ts' });

    expect(copied.map((subject) => [subject.kind, subject.value])).toEqual([
      ['write', NAME],
      ['read', 'source.ts'],
    ]);

    const mine = (yield* preparationOf(inA.write, { path: NAME, fromFile: 'source.ts' })).prepared as {
      file: PreparedPath;
      source: PreparedPath;
    };
    const refused = yield* body(inB.write, { path: NAME, fromFile: 'source.ts' }, mine);
    expect(refused).toContain('cannot be established as the resource this call was allowed over');
  }),
);

it.effect('a resolution outlives the catalog that made it', () =>
  Effect.gen(function* () {
    const input = { path: NAME, content: 'approved\n' };
    const resolution = yield* resolutionOf(inA.write, input);

    yield* body(catalogAt(A).write, input, resolution);
    expect(held(A)).toBe('approved\n');
  }),
);

it.effect('a write into directories that do not exist yet lands over its own resolution', () =>
  Effect.gen(function* () {
    const input = { path: 'fresh/deeper/made.ts', content: 'made\n' };

    yield* body(inA.write, input, yield* resolutionOf(inA.write, input));
    expect(readFileSync(join(A, 'fresh/deeper/made.ts'), 'utf8')).toBe('made\n');
  }),
);

it.effect('an admitted creation edit makes its parents while preparation leaves the path absent', () =>
  Effect.gen(function* () {
    const input = { path: 'fresh-edit/deeper/made.ts', oldString: '', newString: 'made\n' };
    const prepared = yield* resolutionOf(inA.edit, input);
    expect(existsSync(join(A, 'fresh-edit'))).toBe(false);

    yield* body(inA.edit, input, prepared);
    expect(existsSync(join(A, input.path))).toBe(true);
    expect(readFileSync(join(A, input.path), 'utf8')).toBe(input.newString);
  }),
);

it.effect('a resolution made in one root is not admitted in another, and neither file moves', () =>
  Effect.gen(function* () {
    const input = { path: NAME, content: 'must not land\n' };
    const before = { a: held(A), b: held(B) };

    const refused = yield* body(inB.write, input, yield* resolutionOf(inA.write, input));
    expect(refused).toContain('cannot be established as the resource this call was allowed over');
    expect(refused).toContain(join(A, NAME));

    expect(held(A)).toBe(before.a);
    expect(held(B)).toBe(before.b);
  }),
);

it.effect('a body reached without a resolution refuses instead of resolving the words itself', () =>
  Effect.gen(function* () {
    const input = { path: NAME, content: 'must not land\n' };
    const before = held(A);

    const refused = yield* body(inA.write, input, undefined);
    expect(refused).toContain('without the resolution it was judged over');
    expect(held(A)).toBe(before);
  }),
);

it.effect('a read is admitted over its own resolution, whichever catalog runs it', () =>
  Effect.gen(function* () {
    writeFileSync(join(A, 'which.ts'), 'in a\n');
    writeFileSync(join(B, 'which.ts'), 'in b\n');
    const input = { path: 'which.ts' };

    expect(yield* body(inA.read, input, yield* resolutionOf(inA.read, input))).toContain('in a');
    expect(yield* body(inB.read, input, yield* resolutionOf(inB.read, input))).toContain('in b');
    expect(yield* body(inB.read, input, yield* resolutionOf(inA.read, input))).toContain(
      'cannot be established as the resource this call was allowed over',
    );
  }),
);

it.effect('both ends of a move are admitted, and one that cannot be is the whole refusal', () =>
  Effect.gen(function* () {
    const source = join(home, 'root-a', 'moved.ts');
    writeFileSync(source, 'to move\n');
    const input = { from: 'moved.ts', to: 'landed.ts' };

    const resolved = (yield* preparationOf(inA.rename, input)).prepared as {
      from: PreparedPath;
      to: PreparedPath;
    };
    expect(resolved.from.target).toBe(source);
    expect(resolved.to.target).toBe(join(A, 'landed.ts'));

    const refused = yield* body(inB.rename, input, resolved);
    expect(refused).toContain('cannot be established as the resource this call was allowed over');
    expect(readFileSync(source, 'utf8')).toBe('to move\n');

    yield* body(inA.rename, input, resolved);
    expect(readFileSync(join(A, 'landed.ts'), 'utf8')).toBe('to move\n');
  }),
);

it.effect('a move into directories that do not exist yet lands, and the source is gone', () =>
  Effect.gen(function* () {
    writeFileSync(join(A, 'travels.ts'), 'travels\n');
    const input = { from: 'travels.ts', to: 'new/place/travels.ts' };

    const resolved = (yield* preparationOf(inA.rename, input)).prepared;

    yield* body(inA.rename, input, resolved);
    expect(readFileSync(join(A, 'new/place/travels.ts'), 'utf8')).toBe('travels\n');
    expect(existsSync(join(A, 'travels.ts'))).toBe(false);
  }),
);

it.effect('a write through a linked directory and a read of the real file, by any spelling or from another root, claim one file', () =>
  Effect.gen(function* () {
    const link = join(home, 'claims-link');
    symlinkSync(A, link);
    const linked = createTools(options({ cwd: home, allowOutsideCwd: true }));
    const claimsOf = (tool: Tool, input: unknown) => toolClaims(tool, input, { toolCallId: 'call-1', caller: unthreadedCaller });
    const file = { kind: 'file' as const, path: join(A, NAME) };
    expect(yield* claimsOf(linked.write, { path: join(link, NAME), content: 'x\n' })).toEqual([{ on: file, access: 'write' }]);
    expect(yield* claimsOf(inA.read, { path: NAME })).toEqual([{ on: file, access: 'read' }]);
    expect(yield* claimsOf(inA.read, { path: join(A, NAME) })).toEqual([{ on: file, access: 'read' }]);
    expect(yield* claimsOf(inB.read, { path: join('..', 'root-a', NAME) })).toEqual([{ on: file, access: 'read' }]);
    expect(yield* claimsOf(linked.bash!, { command: `rm ${join(link, NAME)}` })).toContainEqual({ on: file, access: 'write' });
    expect(yield* claimsOf(linked.bash!, { command: `rm ${link}` })).toContainEqual({ on: { kind: 'file', path: link }, access: 'write' });
    expect(yield* claimsOf(inA.bash!, { command: `git add ${NAME}` })).toEqual([{ on: { kind: 'all' }, access: 'write' }]);
    rmSync(link);
  }),
);
