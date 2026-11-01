import { expect, test } from 'bun:test';
import { type Command, Lives } from './lives.js';
import type { Role } from './roles.js';

const CHECKOUT = 'host:repo';

const clock = () => {
  let now = 0;
  return { now: () => now, at: (ms: number) => void (now = ms) };
};

const instant = (at: number) => ({ from: at, to: at });

const as = (role: Role): Command => ({ id: null, role, signatures: [], team: null, line: null });
const READER = as({ kind: 'reader', implicit: ['__snapshots__/', '*.snap'] });
const named = (...paths: string[]) => as({ kind: 'named', paths, implicit: [] });

test('a write while commands of two sessions ran is nobody’s, from either side, and a write only one opaque command lived at is unproven', () => {
  const time = clock();
  const lives = new Lives(time.now);
  time.at(0);
  const tests = lives.open(CHECKOUT, 'session-b');
  tests.opened();
  time.at(10_000);
  const script = lives.open(CHECKOUT, 'session-a');
  script.opened();
  time.at(13_000);
  script.ended();
  const written = { name: 'src/gen-1.ts', after: 'v1', written: instant(11_500) };
  expect(lives.decide(CHECKOUT, script.life, written, { from: 9_900, to: 13_100 })).toMatchObject({ kind: 'overlap', basis: 'overlap' });
  time.at(60_000);
  tests.ended();
  expect(lives.decide(CHECKOUT, tests.life, written, { from: -100, to: 60_100 })).toMatchObject({ kind: 'overlap' });
  expect(lives.decide(CHECKOUT, tests.life, { ...written, written: instant(30_000) }, { from: -100, to: 60_100 })).toMatchObject({
    kind: 'overlap',
    basis: 'unproven',
  });
});

test('a removal dated only by a later change of its directory is nobody’s when another session’s command ran before that change', () => {
  const time = clock();
  const lives = new Lives(time.now);
  const typecheck = lives.open(CHECKOUT, 'session-a');
  typecheck.opened();
  time.at(10_000);
  const remove = lives.open(CHECKOUT, 'session-b');
  remove.opened();
  time.at(10_500);
  remove.ended();
  time.at(60_000);
  typecheck.ended();
  const gone = { name: 'src/old.ts', after: 'absent', written: { from: -100, to: 30_000 } };
  expect(lives.decide(CHECKOUT, typecheck.life, gone, { from: -100, to: 60_100 })).toMatchObject({ kind: 'overlap' });
});

test('a command that writes nothing is no writer: a write while it ran beside another session’s command naming the path is that command’s', () => {
  const time = clock();
  const lives = new Lives(time.now);
  const count = lives.reading(CHECKOUT, 'session-a');
  count.opened();
  const format = lives.open(CHECKOUT, 'session-b', named('src/a.ts'));
  format.opened();
  time.at(1_000);
  count.ended();
  format.ended();
  const written = { name: 'src/a.ts', after: 'v1', written: instant(500) };
  const window = { from: -100, to: 1_100 };
  expect(lives.decide(CHECKOUT, count.life, written, window)).toMatchObject({ kind: 'taken', by: 'session-b' });
  expect(lives.decide(CHECKOUT, format.life, written, window)).toMatchObject({ kind: 'mine' });
});

test('a write two other sessions’ commands overlapped is not charged to a command whose life missed it', () => {
  const time = clock();
  const lives = new Lives(time.now);
  const late = lives.open(CHECKOUT, 'session-a');
  const first = lives.open(CHECKOUT, 'session-b');
  first.opened();
  const second = lives.open(CHECKOUT, 'session-c');
  second.opened();
  time.at(500);
  first.ended();
  second.ended();
  late.opened();
  time.at(1_000);
  late.ended();
  const written = { name: 'src/a.ts', after: 'v1', written: instant(200) };
  expect(lives.decide(CHECKOUT, late.life, written, { from: 0, to: 1_100 })).toMatchObject({ kind: 'unclaimed' });
  expect(lives.decide(CHECKOUT, first.life, written, { from: -100, to: 600 })).toMatchObject({ kind: 'overlap' });
});

test('a file tool write of that very version at that moment takes the path, and a write of another version does not', () => {
  const time = clock();
  const lives = new Lives(time.now);
  const command = lives.open(CHECKOUT, 'session-a', named('src/a.ts', 'src/b.ts'));
  command.opened();
  lives.instant(CHECKOUT, 'session-b', 'src/a.ts', 'v2', 500, 500);
  time.at(1_000);
  command.ended();
  const window = { from: -100, to: 1_100 };
  expect(lives.decide(CHECKOUT, command.life, { name: 'src/a.ts', after: 'v2', written: instant(505) }, window)).toMatchObject({
    kind: 'taken',
    by: 'session-b',
    basis: 'marks',
  });
  expect(lives.decide(CHECKOUT, command.life, { name: 'src/a.ts', after: 'v3', written: instant(505) }, window)).toMatchObject({
    kind: 'mine',
  });
  expect(lives.decide(CHECKOUT, command.life, { name: 'src/b.ts', after: 'v2', written: instant(505) }, window)).toMatchObject({
    kind: 'mine',
  });
});

test('a command refused before it ran is forgotten and takes no write', () => {
  const time = clock();
  const lives = new Lives(time.now);
  const format = lives.open(CHECKOUT, 'session-b', named('src/a.ts'));
  format.opened();
  time.at(500);
  const refused = lives.open(CHECKOUT, 'session-a', named('src/a.ts'));
  refused.opened();
  time.at(505);
  refused.forget();
  time.at(1_000);
  format.ended();
  expect(
    lives.decide(CHECKOUT, format.life, { name: 'src/a.ts', after: 'v1', written: instant(502) }, { from: 0, to: 1_100 }),
  ).toMatchObject({
    kind: 'mine',
  });
});

test('an opaque writer among readers of two other sessions does not prove a write: it alone observes it, unproven', () => {
  const time = clock();
  const lives = new Lives(time.now);
  const tests = lives.open(CHECKOUT, 'session-a', READER);
  tests.opened();
  const typecheck = lives.open(CHECKOUT, 'session-b', READER);
  typecheck.opened();
  time.at(10_000);
  const script = lives.open(CHECKOUT, 'session-c');
  script.opened();
  time.at(11_000);
  script.ended();
  time.at(60_000);
  tests.ended();
  typecheck.ended();
  const written = { name: 'src/gen.ts', after: 'v1', written: instant(10_500) };
  expect(lives.decide(CHECKOUT, script.life, written, { from: 9_900, to: 11_100 })).toMatchObject({
    kind: 'overlap',
    basis: 'unproven',
    counted: true,
  });
  expect(lives.decide(CHECKOUT, tests.life, written, { from: -100, to: 60_100 })).toMatchObject({ kind: 'unclaimed' });
  const gone = { name: 'src/fixture.ts', after: 'absent', written: { from: -100, to: 10_500 } };
  expect(lives.decide(CHECKOUT, script.life, gone, { from: 9_900, to: 11_100 })).toMatchObject({ kind: 'overlap', basis: 'unproven' });
  expect(lives.decide(CHECKOUT, typecheck.life, gone, { from: -100, to: 60_100 })).toMatchObject({ kind: 'unclaimed' });
});

test('two writers of different trees at the moment of the write leave it an overlap, and two of one tree leave it to that tree', () => {
  const decided = (teams: readonly [string | null, string | null]) => {
    const time = clock();
    const lives = new Lives(time.now);
    const one = lives.open(CHECKOUT, 'session-a', { ...as({ kind: 'writer' }), team: teams[0] });
    one.opened();
    const two = lives.open(CHECKOUT, 'session-b', { ...as({ kind: 'writer' }), team: teams[1] });
    two.opened();
    time.at(1_000);
    one.ended();
    two.ended();
    return lives.decide(CHECKOUT, one.life, { name: 'src/a.ts', after: 'v1', written: instant(500) }, { from: -100, to: 1_100 });
  };
  expect(decided(['root-a', 'root-b'])).toMatchObject({ kind: 'overlap', basis: 'overlap' });
  expect(decided(['root', null])).toMatchObject({ kind: 'overlap', basis: 'overlap' });
  expect(decided(['root', 'root'])).toMatchObject({ kind: 'team', root: 'root', basis: 'team' });
});

test('a writer of named paths takes the paths it names, and a path outside them is nobody’s even when it alone lived', () => {
  const time = clock();
  const lives = new Lives(time.now);
  const format = lives.open(CHECKOUT, 'session-a', named('src/a.ts'));
  format.opened();
  const tests = lives.open(CHECKOUT, 'session-b', READER);
  tests.opened();
  time.at(1_000);
  format.ended();
  time.at(2_000);
  tests.ended();
  const window = { from: -100, to: 2_100 };
  expect(lives.decide(CHECKOUT, format.life, { name: 'src/b.ts', after: 'v1', written: instant(500) }, window)).toMatchObject({
    kind: 'overlap',
  });
  expect(lives.decide(CHECKOUT, tests.life, { name: 'src/b.ts', after: 'v1', written: instant(500) }, window)).toMatchObject({
    kind: 'overlap',
  });
  expect(lives.decide(CHECKOUT, format.life, { name: 'src/a.ts', after: 'v1', written: instant(500) }, window)).toMatchObject({
    kind: 'mine',
    basis: 'sets',
  });
  expect(lives.decide(CHECKOUT, tests.life, { name: 'src/a.ts', after: 'v1', written: instant(500) }, window)).toMatchObject({
    kind: 'taken',
    by: 'session-a',
  });
  const alone = new Lives(time.now);
  time.at(3_000);
  const only = alone.open(CHECKOUT, 'session-a', named('src/a.ts'));
  only.opened();
  time.at(4_000);
  only.ended();
  expect(
    alone.decide(CHECKOUT, only.life, { name: 'src/b.ts', after: 'v1', written: instant(3_500) }, { from: 2_900, to: 4_100 }),
  ).toMatchObject({
    kind: 'overlap',
    basis: 'unproven',
  });
});

test('a snapshot is the test run’s beside any other command, since the test run alone names it', () => {
  const time = clock();
  const lives = new Lives(time.now);
  const tests = lives.open(CHECKOUT, 'session-a', READER);
  tests.opened();
  const script = lives.open(CHECKOUT, 'session-b');
  script.opened();
  time.at(1_000);
  tests.ended();
  script.ended();
  const snapshot = { name: 'src/__snapshots__/a.test.ts.snap', after: 'v1', written: instant(500) };
  expect(lives.decide(CHECKOUT, tests.life, snapshot, { from: -100, to: 1_100 })).toMatchObject({ kind: 'mine', basis: 'sets' });
  const sole = new Lives(time.now);
  const run = sole.open(CHECKOUT, 'session-a', READER);
  run.opened();
  const format = sole.open(CHECKOUT, 'session-b', named('src/a.ts'));
  format.opened();
  time.at(2_000);
  run.ended();
  format.ended();
  expect(sole.decide(CHECKOUT, run.life, { ...snapshot, written: instant(1_500) }, { from: 900, to: 2_100 })).toMatchObject({
    kind: 'mine',
    basis: 'sets',
  });
  const readers = new Lives(time.now);
  const own = readers.open(CHECKOUT, 'session-a', READER);
  own.opened();
  const check = readers.open(CHECKOUT, 'session-b', as({ kind: 'reader', implicit: [] }));
  check.opened();
  time.at(3_000);
  own.ended();
  check.ended();
  expect(readers.decide(CHECKOUT, check.life, { ...snapshot, written: instant(2_500) }, { from: 1_900, to: 3_100 })).toMatchObject({
    kind: 'taken',
    by: 'session-a',
    basis: 'sets',
  });
});

test('a write at a known moment that no life touched is untouched, and a write without a moment is judged by the window', () => {
  const time = clock();
  const lives = new Lives(time.now);
  time.at(500);
  const command = lives.open(CHECKOUT, 'session-a');
  time.at(550);
  command.opened();
  time.at(1_000);
  command.ended();
  const window = { from: 500, to: 1_100 };
  expect(lives.decide(CHECKOUT, command.life, { name: 'src/a.ts', after: 'v1', written: instant(510) }, window)).toMatchObject({
    kind: 'unclaimed',
    basis: 'untouched',
  });
  expect(lives.decide(CHECKOUT, command.life, { name: 'src/a.ts', after: 'v1', written: null }, window)).toMatchObject({
    kind: 'overlap',
    basis: 'unproven',
  });
});
