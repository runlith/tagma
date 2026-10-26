import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { join } from 'node:path';
import { nativeLanding } from './native.js';

const text = (...lines: string[]) => `${lines.join('\n')}\n`;
const entry = (name: string, ...keys: string[]) => [
  `    "./${name}": {`,
  ...keys.map((key, at) => `      "${key}": "./src/${name}.ts"${at + 1 < keys.length ? ',' : ''}`),
  '    },',
];
const manifest = (exports: readonly string[], dependencies: readonly string[]) =>
  text(
    '{',
    '  "exports": {',
    ...exports,
    ...entry('accounts', 'types', 'browser', 'default').slice(0, -1),
    '    }',
    '  },',
    '  "dependencies": {',
    ...dependencies,
    '    "@example/inspection": "workspace:*"',
    '  }',
    '}',
  );

it.live('native submit_work lands inserted entries with their closing lines while two peers delete equal lines beside them', () =>
  Effect.gen(function* () {
    const reports = entry('reports', 'types', 'default');
    const state = entry('state', 'types', 'browser', 'default');
    const added = [...entry('operator', 'types', 'default'), ...entry('web', 'types', 'default')];
    const cloud = ['    "@example/cloud": "workspace:*",'];
    const inserted = manifest([...added, ...reports, ...state], cloud);
    const work = manifest(added, []);
    const { doors, born, write, read } = yield* nativeLanding({ 'package.json': manifest([...reports, ...state], cloud) });
    const [capture, access, demo] = [yield* born(), yield* born(), yield* born()];
    yield* write(capture.threadId, 'package.json', inserted);
    yield* write(access.threadId, 'package.json', manifest([...added, ...reports], []));
    yield* write(demo.threadId, 'package.json', work);
    expect(yield* doors.atNative('submit_work', { subject: 'add exports' }, capture)).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: ['package.json'], carried: [] } },
    });
    expect(yield* read('package.json')).toBe(inserted);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('native submit_work keeps a surviving block whole when peers delete every block before it and append blocks after it', () =>
  Effect.gen(function* () {
    const block = (name: string, calls: number) => [
      `function ${name}() {`,
      ...Array.from({ length: calls }, (_, at) => `  ${name}${at}();`),
      '}',
    ];
    const blocks = {
      n0: block('n0', 2),
      n1: block('n1', 1),
      n2: block('n2', 3),
      n3: block('n3', 1),
      n4: block('n4', 1),
      n5: block('n5', 3),
      n6: block('n6', 1),
    };
    const file = (...names: (keyof typeof blocks)[]) => text(...names.flatMap((name) => blocks[name]));
    const { doors, born, write, read } = yield* nativeLanding({ 'blocks.txt': file('n0', 'n1', 'n2', 'n3') });
    const [first, second, third] = [yield* born(), yield* born(), yield* born()];
    yield* write(first.threadId, 'blocks.txt', file('n0', 'n2', 'n3'));
    yield* write(first.threadId, 'blocks.txt', file('n0', 'n2', 'n3', 'n4'));
    yield* write(second.threadId, 'blocks.txt', file('n0', 'n2', 'n3', 'n4', 'n5'));
    yield* write(second.threadId, 'blocks.txt', file('n2', 'n3', 'n4', 'n5'));
    yield* write(third.threadId, 'blocks.txt', file('n3', 'n4', 'n5'));
    yield* write(third.threadId, 'blocks.txt', file('n3', 'n4', 'n6', 'n5'));
    expect(yield* doors.atNative('submit_work', { subject: 'replace n2 with n6' }, third)).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: ['blocks.txt'], carried: [] } },
    });
    expect(yield* read('blocks.txt')).toBe(file('n0', 'n1', 'n3', 'n6'));
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('native submit_work slices a landing exactly when earlier landings rebuilt HEAD from the same working file', () =>
  Effect.gen(function* () {
    const blocks = {
      n0: entry('n0', 'n00', 'n01', 'n02'),
      n1: entry('n1', 'n10'),
      n2: entry('n2', 'n20', 'n21'),
    };
    const file = (...names: (keyof typeof blocks)[]) => text('{', '  "exports": {', ...names.flatMap((name) => blocks[name]), '  }', '}');
    const { doors, born, write, read } = yield* nativeLanding({ 'exports.txt': file('n0', 'n1') });
    const [first, second, third] = [yield* born(), yield* born(), yield* born()];
    yield* write(first.threadId, 'exports.txt', file('n1'));
    yield* write(second.threadId, 'exports.txt', file('n2', 'n1'));
    yield* write(third.threadId, 'exports.txt', file('n2'));
    for (const [session, subject] of [
      [third, 'drop n1'],
      [second, 'add n2'],
      [first, 'drop n0'],
    ] as const)
      expect(yield* doors.atNative('submit_work', { subject }, session)).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['exports.txt'] } },
      });
    expect(yield* read('exports.txt')).toBe(file('n2'));
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('native submit_work slices a landing exactly after earlier landings retired the peers written between its edits', () =>
  Effect.gen(function* () {
    const blocks = {
      n0: entry('n0', 'n00', 'n01', 'n02'),
      n1: entry('n1', 'n10'),
      n2: entry('n2', 'n20', 'n21'),
      n3: entry('n3', 'n30'),
      n4: entry('n4', 'n40', 'n41'),
      n5: entry('n5', 'n50', 'n51', 'n52'),
    };
    const file = (...names: (keyof typeof blocks)[]) => text('{', '  "exports": {', ...names.flatMap((name) => blocks[name]), '  }', '}');
    const { doors, born, write, read } = yield* nativeLanding({ 'exports.txt': file('n0', 'n1', 'n2', 'n3') });
    const [first, second, third] = [yield* born(), yield* born(), yield* born()];
    yield* write(first.threadId, 'exports.txt', file('n0', 'n1', 'n3'));
    yield* write(first.threadId, 'exports.txt', file('n0', 'n1', 'n4', 'n3'));
    yield* write(second.threadId, 'exports.txt', file('n0', 'n1', 'n4'));
    yield* write(third.threadId, 'exports.txt', file('n0', 'n5', 'n1', 'n4'));
    for (const [session, subject] of [
      [third, 'add n5'],
      [second, 'drop n3'],
      [first, 'replace n2 with n4'],
    ] as const)
      expect(yield* doors.atNative('submit_work', { subject }, session)).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['exports.txt'] } },
      });
    expect(yield* read('exports.txt')).toBe(file('n0', 'n5', 'n1', 'n4'));
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('native submit_work slices a landing exactly when an earlier landing kept its removed lines and was written before it', () =>
  Effect.gen(function* () {
    const block = (name: string, calls: number) => [
      `function ${name}() {`,
      ...Array.from({ length: calls }, (_, at) => `  ${name}${at}();`),
      '}',
    ];
    const blocks = { n0: block('n0', 2), n1: block('n1', 1), n2: block('n2', 1), n3: block('n3', 1), n4: block('n4', 3) };
    const file = (...names: (keyof typeof blocks)[]) => text(...names.flatMap((name) => blocks[name]));
    const { doors, born, write, read } = yield* nativeLanding({ 'blocks.txt': file('n0', 'n1') });
    const [first, second, third] = [yield* born(), yield* born(), yield* born()];
    yield* write(first.threadId, 'blocks.txt', file('n0', 'n1', 'n2'));
    yield* write(second.threadId, 'blocks.txt', file('n1', 'n2'));
    yield* write(second.threadId, 'blocks.txt', file('n3', 'n1', 'n2'));
    yield* write(third.threadId, 'blocks.txt', file('n3', 'n4', 'n1', 'n2'));
    yield* write(third.threadId, 'blocks.txt', file('n3', 'n4', 'n2'));
    for (const [session, subject] of [
      [first, 'add n2'],
      [second, 'replace n0 with n3'],
    ] as const)
      expect(yield* doors.atNative('submit_work', { subject }, session)).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['blocks.txt'] } },
      });
    expect(yield* read('blocks.txt')).toBe(file('n3', 'n4', 'n2'));
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('native submit_work keeps out a peer whose only line the shortest diff cancels against the lander’s', () =>
  Effect.gen(function* () {
    const { files, root, doors, born, write, read } = yield* nativeLanding({ 'block.txt': text('}', 'keep') });
    const [mine, peer] = [yield* born(), yield* born()];
    yield* write(mine.threadId, 'block.txt', text('x', '}', '}', 'keep'));
    yield* write(peer.threadId, 'block.txt', text('x', '}', 'keep'));
    expect(yield* doors.atNative('submit_work', { subject: 'open a block' }, mine)).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: ['block.txt'], carried: [] } },
    });
    expect(yield* read('block.txt')).toBe(text('x', '}', '}', 'keep'));
    expect(yield* files.readFileString(join(root, 'block.txt'))).toBe(text('x', '}', 'keep'));
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
