import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { join } from 'node:path';
import { nativeLanding } from './native.js';
import { scriptedModel } from '../scriptedModel.js';

const context = `import { keyed, type Context } from './shared.ts';
import { failure } from './diagnostics.ts';

interface Layer {
\treadonly parent: Layer | null;
\tmap: Map<unknown, unknown> | null;
}

interface Render {
\tlayer: Layer | null;
\treadonly destroys: (() => void)[];
}

let render: Render | null = null;

export function push(map?: Map<unknown, unknown>): void {
\tif (render === null) return;
\trender.layer = { parent: render.layer, map: map ?? null };
}

export function pop(): void {
\tif (render !== null) render.layer = render.layer?.parent ?? null;
}

export function begin(): Render | null {
\tconst saved = render;
\trender = { layer: null, destroys: [] };
\treturn saved;
}

export function end(saved: Render | null): void {
\tconst done = render;
\trender = saved;
\tfor (const fn of done?.destroys ?? []) fn();
}

export function capture(): () => void {
\tconst captured = render;
\tconst layer = captured?.layer ?? null;
\treturn () => {
\t\trender = captured;
\t\tif (captured !== null) captured.layer = layer;
\t\tqueueMicrotask(() => {
\t\t\tif (render === captured) render = null;
\t\t});
\t};
}

export async function save<T>(value: T | PromiseLike<T>): Promise<() => T> {
\tconst restore = capture();
\tconst resolved = await value;
\treturn () => {
\t\trestore();
\t\treturn resolved;
\t};
}

export type Phase = 'initializing' | null;

export function phase(): Phase {
\treturn render?.layer != null ? 'initializing' : null;
}

export function getContext<T>(key: unknown): T {
\tfor (let layer = render?.layer ?? null; layer !== null; layer = layer.parent) {
\t\tif (layer.map?.has(key)) return layer.map.get(key) as T;
\t}
\treturn undefined as T;
}

export function setContext<T>(key: unknown, value: T): T {
\tconst layer = render?.layer;
\tif (layer == null) {
\t\tthrow failure('context_without_owner', 'Context can only be set where an owner exists');
\t}
\t(layer.map ??= new Map()).set(key, value);
\treturn value;
}

export function hasContext(key: unknown): boolean {
\tfor (let layer = render?.layer ?? null; layer !== null; layer = layer.parent) {
\t\tif (layer.map?.has(key)) return true;
\t}
\treturn false;
}

export function createContext<T>(): Context<T> {
\treturn keyed<T>({ getContext, setContext, hasContext });
}

export function getAllContexts<T extends Map<unknown, unknown> = Map<unknown, unknown>>(): T {
\tconst chain: Layer[] = [];
\tfor (let layer = render?.layer ?? null; layer !== null; layer = layer.parent) chain.push(layer);
\tconst all = new Map<unknown, unknown>();
\tfor (let index = chain.length - 1; index >= 0; index--) {
\t\tfor (const [key, value] of chain[index]?.map ?? []) all.set(key, value);
\t}
\treturn all as T;
}

export function onDestroy(fn: () => void): void {
\trender?.destroys.push(fn);
}
`;
const begin = `export function begin(): Render | null {
\tconst saved = render;
\trender = { layer: null, destroys: [] };`;
const hydration = `export function begin(hydration: Data | null = null): Render | null {
\tconst saved = render;
\trender = { layer: null, destroys: [], hydration };`;
const extended = `export function begin(hydration: Data | null = null, signal?: () => AbortSignal): Render | null {
\tconst saved = render;
\trender = { layer: null, destroys: [], hydration, signal };`;

it.live('native submit_work preserves dependent initialization and isolates an exact edit beside a large peer migration', () =>
  Effect.gen(function* () {
    const tests = Array.from({ length: 900 }, (_, at) => [
      `test('t${at}', () => {`,
      `  const v = ${at};`,
      `  expect(v).toBe(${at});`,
      '});',
      '',
    ]).flat();
    const text = (rows: readonly string[]) => `${rows.join('\n')}\n`;
    const migrated = ["describe('runner', () => {", ...tests.map((line) => (line === '' ? '' : `  ${line}`)), '});'];
    const assertions = [
      'expect(outcome.status).toBe("cancelled");',
      'expect(outcome.reason).toBe("stop");',
      'expect(report.reason).toBe("stop");',
    ];
    const { born, doors, read, write, root, files } = yield* nativeLanding(
      {
        'context.ts': context,
        'hydration.ts': 'export interface Data { readonly value: string }\n',
        'shared.ts': 'export interface Context<T> {}\nexport const keyed = <T>(value: unknown): Context<T> => ({});\n',
        'diagnostics.ts': 'export const failure = (code: string, message: string) => new Error(message);\n',
        'render.ts': "import { begin } from './context.ts';\nexport const render = () => begin();\n",
        'independent.txt': 'base\n',
        'runner.test.ts': text(tests),
      },
      { tools: ['edit', 'submit_work'], models: scriptedModel() },
    );
    const actor = yield* born();
    const peer = yield* born();
    const edit = Effect.fnUntraced(function* (at: typeof actor, path: string, oldString: string, newString: string) {
      expect(yield* doors.atNative('edit', { path: join(root, path), oldString, newString }, at)).toMatchObject({ class: 'answer' });
    });
    yield* edit(
      actor,
      'context.ts',
      "import { failure } from './diagnostics.ts';",
      "import { failure } from './diagnostics.ts';\nimport type { Data } from './hydration.ts';",
    );
    yield* edit(
      actor,
      'context.ts',
      '\treadonly destroys: (() => void)[];\n}',
      '\treadonly destroys: (() => void)[];\n\treadonly hydration: Data | null;\n}',
    );
    yield* edit(actor, 'context.ts', begin, hydration);
    yield* edit(
      actor,
      'context.ts',
      'export function end(saved: Render | null): void {',
      'export function hydrationData(): Data | null {\n\treturn render?.hydration ?? null;\n}\n\nexport function end(saved: Render | null): void {',
    );
    yield* edit(
      peer,
      'context.ts',
      '\treadonly hydration: Data | null;\n}',
      '\treadonly hydration: Data | null;\n\treadonly signal: (() => AbortSignal) | undefined;\n}',
    );
    yield* edit(peer, 'context.ts', hydration, extended);
    yield* edit(
      peer,
      'context.ts',
      'let render: Render | null = null;',
      'let render: Render | null = null;\nlet destroying: Render | null = null;',
    );
    yield* edit(
      peer,
      'context.ts',
      '\trender = saved;\n\tfor (const fn of done?.destroys ?? []) fn();\n}',
      '\trender = saved;\n\tconst previous = destroying;\n\tdestroying = done;\n\ttry {\n\t\tfor (const fn of done?.destroys ?? []) fn();\n\t} finally {\n\t\tdestroying = previous;\n\t}\n}\n\nexport function getAbortSignal(): AbortSignal {\n\treturn (destroying ?? render)?.signal?.() ?? new AbortController().signal;\n}',
    );
    yield* edit(peer, 'render.ts', '() => begin()', '(signalFactory: () => AbortSignal) => begin()');
    yield* edit(actor, 'render.ts', 'begin();', "begin({ value: 'data' }, signalFactory);");
    yield* edit(peer, 'independent.txt', 'base', 'peer');
    yield* write(peer.threadId, 'runner.test.ts', text(migrated));
    yield* edit(actor, 'runner.test.ts', "  test('t401', () => {", `${text(assertions)}  test('t401', () => {`);
    const complete = yield* files.readFileString(join(root, 'context.ts'));
    const landed = yield* doors.atNative(
      'submit_work',
      { subject: 'land hydration context', paths: ['context.ts', 'render.ts', 'runner.test.ts'] },
      actor,
    );
    expect(landed).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: ['context.ts', 'render.ts', 'runner.test.ts'] } },
    });
    expect(yield* read('context.ts')).toBe(complete);
    expect(landed).toMatchObject({ value: { submitted: { carried: [{ path: 'context.ts', holders: [peer.threadId] }] } } });
    expect(yield* read('render.ts')).toBe(yield* files.readFileString(join(root, 'render.ts')));
    expect(yield* read('runner.test.ts')).toBe(text([...tests.slice(0, 2005), ...assertions, ...tests.slice(2005)]));
    expect(yield* files.readFileString(join(root, 'runner.test.ts'))).toBe(
      text([...migrated.slice(0, 2006), ...assertions, ...migrated.slice(2006)]),
    );
    expect(yield* read('independent.txt')).toBe('base\n');
    expect(yield* files.readFileString(join(root, 'independent.txt'))).toBe('peer\n');
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
