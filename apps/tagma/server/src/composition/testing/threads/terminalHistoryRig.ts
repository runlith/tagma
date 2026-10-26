import { isAbsolute, join } from 'node:path';
import { Context, Effect, FileSystem, Schedule, Stream } from 'effect';
import { HARNESSES } from '../../../external-harnesses/contract/service/table.js';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { Terminals } from '../../../executions/contract/service/terminals.js';
import { TerminalScreens } from '../../../executions/contract/service/records.js';
import { screenLines } from '@runlith/executions/protocol/presentationText';
import { makeDoorWorld, projectLeaving } from '../doorFixture.js';
import { claudeLogin } from '../claudeLogin.js';
import { deliveryRig } from './terminalDeliveryRig.js';
import { stamp, terminalRig } from './terminalRig.js';

const ANSWERING = [
  '#!/bin/sh',
  'case "$1" in --version) echo "2.1.310 (Claude Code)"; exit 0;; auth) echo \'{"loggedIn":false}\'; exit 0;; esac',
];

const TUI = `const { appendFileSync, existsSync, readFileSync, watch } = require('node:fs');
const [report, keys, ...argv] = process.argv.slice(2);
const rule = '─'.repeat(40);
const heard = (event) => appendFileSync(keys + '.events', JSON.stringify({ pid: process.pid, ...event }) + '\\n');
appendFileSync(report, JSON.stringify(argv) + '\\n');
heard({ kind: 'boot', argv });
for (const signal of ['SIGHUP', 'SIGTERM'])
  process.on(signal, () => {
    if (existsSync(keys + '.linger')) return;
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  });
let typed = '';
let drawn = null;
const draw = () => {
  const draft = existsSync(keys + '.draft') ? readFileSync(keys + '.draft', 'utf8') : '';
  const composer = (draft + typed).trim();
  const screen = rule + '\\r\\n❯' + (composer === '' ? '' : ' ' + composer) + '\\r\\n' + rule + '\\r\\n';
  if (screen === drawn) return;
  drawn = screen;
  process.stdout.write('\\x1b[2J\\x1b[H' + screen);
};
process.stdout.write('\\x1b[?2004h');
process.stdin.setRawMode(true);
const OPEN = '\\x1b[200~';
const CLOSE = '\\x1b[201~';
let pending = '';
process.stdin.on('data', (chunk) => {
  pending += chunk.toString('utf8');
  for (;;) {
    if (pending.startsWith(OPEN)) {
      const end = pending.indexOf(CLOSE);
      if (end < 0) break;
      const text = pending.slice(OPEN.length, end).replace(/\\r/g, '\\n');
      typed += text;
      heard({ kind: 'paste', text });
      pending = pending.slice(end + CLOSE.length);
    } else if (pending.startsWith('\\x1b')) {
      if (pending.length < OPEN.length) break;
      pending = pending.slice(1);
    } else if (pending.startsWith('\\r')) {
      heard({ kind: 'enter', text: typed });
      typed = '';
      pending = pending.slice(1);
    } else if (pending.length > 0) pending = pending.slice(1);
    else break;
  }
  draw();
});
watch(require('node:path').dirname(keys), draw);
draw();
`;

const CUT_SERVER = `const { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const [log, home, fixture] = process.argv.slice(2);
const recorded = fixture === undefined ? null : require(fixture);
let buffer = '';
let pending = Promise.resolve();
const held = new Set();
process.on('exit', () => { for (const marker of held) rmSync(marker, { force: true }); });
const answer = async (method, params) => {
  if ((method === 'fork' || method === 'thread/fork') && existsSync(join(home, 'hold'))) {
    const marker = join(home, 'waiting-' + randomUUID());
    writeFileSync(marker, '');
    held.add(marker);
    try {
      await new Promise((resolve) => {
        const timer = setInterval(() => {
          if (existsSync(join(home, 'hold'))) return;
          clearInterval(timer);
          resolve();
        }, 20);
      });
    } finally {
      held.delete(marker);
      rmSync(marker, { force: true });
    }
  }
  if (method === 'initialize') return {};
  if (method === 'thread/start' || method === 'thread/fork') {
    const read = method === 'thread/start' ? { thread: { ...recorded.cut.thread, id: recorded.cut.thread.forkedFromId, turns: [] } } :
      params.beforeTurnId === undefined ? recorded.wholeRead : recorded.cutRead;
    const thread = { ...read.thread, id: method === 'thread/start' ? read.thread.id : randomUUID() };
    mkdirSync(home, { recursive: true });
    const path = join(home, thread.id + '.jsonl');
    writeFileSync(path, JSON.stringify({ type: 'session_meta', payload: { id: thread.id, session_id: thread.id, history_mode: 'paginated' } }) + '\\n');
    const answer = { ...read, thread: { ...thread, path } };
    writeFileSync(join(home, thread.id + '.read.json'), JSON.stringify(answer));
    return answer;
  }
  if (method === 'thread/read') return JSON.parse(readFileSync(join(home, params.threadId + '.read.json'), 'utf8'));
  if (method === 'fork') {
    const sessionId = randomUUID();
    mkdirSync(home, { recursive: true });
    const path = join(home, sessionId + '.jsonl');
    writeFileSync(path, JSON.stringify({ type: 'user', sessionId, uuid: 'copy-' + sessionId, message: { role: 'user', content: 'copied' } }) + '\\n');
    return { sessionId, path };
  }
  const turns = join(home, 'turns.json');
  return { addresses: existsSync(turns) ? JSON.parse(readFileSync(turns, 'utf8')) : [null] };
};
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  pending = pending.then(async () => {
    for (let at = buffer.indexOf('\\n'); at >= 0; at = buffer.indexOf('\\n')) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (line.trim() === '') continue;
      const { id, method, params } = JSON.parse(line);
      const result = await answer(method, params);
      appendFileSync(log, JSON.stringify({ method, params, result }) + '\\n');
      process.stdout.write(JSON.stringify({ id, result }) + '\\n');
    }
  }).catch((error) => { console.error(error); process.exit(1); });
});
process.stdin.on('end', () => process.exit(0));
`;

export type CutAsked = { readonly method: string; readonly params: Record<string, unknown>; readonly result: Record<string, unknown> };

export type Boot = { readonly pid: number; readonly argv: readonly string[] };

export type TuiEvent =
  | { readonly kind: 'boot'; readonly pid: number; readonly argv: readonly string[] }
  | { readonly kind: 'paste'; readonly pid: number; readonly text: string }
  | { readonly kind: 'enter'; readonly pid: number; readonly text: string };

const linesOf = <A>(files: FileSystem.FileSystem, path: string) =>
  Effect.map(
    Effect.flatMap(files.exists(path), (exists) => (exists ? files.readFileString(path) : Effect.succeed(''))),
    (text) =>
      text
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as A),
  );

export const terminalHistoryWorld = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const stage = yield* files.makeTempDirectoryScoped({ prefix: 'terminal-history-' });
  const bin = join(stage, 'bin');
  yield* files.makeDirectory(bin);
  for (const binary of HARNESSES.map(({ binary }) => binary).filter((binary) => !isAbsolute(binary)))
    yield* files.writeFileString(join(bin, binary), '#!/bin/sh\nprintf "fixture\\n"\n', { mode: 0o755 });
  yield* files.writeFileString(join(stage, 'tui.js'), TUI);
  yield* files.writeFileString(join(stage, 'cut.js'), CUT_SERVER);
  const cuts = join(stage, 'cut.log');
  const forks = join(stage, 'forks');
  yield* files.writeFileString(
    join(bin, WORLD_COMMAND),
    [
      '#!/bin/sh',
      `if [ "$1" = harness-run ] && [ "$3" = --cut ]; then exec ${process.execPath} ${join(stage, 'cut.js')} ${cuts} ${forks}; fi`,
      'printf "fixture\\n"',
    ].join('\n'),
    { mode: 0o755 },
  );
  const path = process.env.PATH;
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.env.PATH = `${bin}:${path ?? ''}`;
    }),
    () =>
      Effect.sync(() => {
        if (path === undefined) delete process.env.PATH;
        else process.env.PATH = path;
      }),
  );
  const world = yield* makeDoorWorld({
    models: (standing) => ({ ...standing, request: (input) => ({ ...standing.request(input), stream: () => Stream.never }) }),
  });
  yield* claudeLogin(world);
  const projectId = yield* world.stealthProject(yield* world.directory('history-project'));
  yield* projectLeaving(world, projectId);
  yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
  const rig = yield* terminalRig(world, projectId, yield* world.directory('terminal-history'));
  const flow = deliveryRig(world, rig);

  const raised = Effect.fn('testing.historyClaude')(function* (name: string, harness: 'claude-code' | 'codex' | 'grok') {
    const report = join(stage, `${name}.argv`);
    const keys = join(stage, `${name}.keys`);
    const binary = harness === 'claude-code' ? 'claude' : harness;
    const answering =
      harness === 'claude-code'
        ? ANSWERING
        : [
            '#!/bin/sh',
            `case "$1" in --version) echo "${harness === 'codex' ? 'codex-cli 0.162.0' : 'grok 1.0.62'}"; exit 0;; esac`,
            ...(harness === 'codex'
              ? [
                  `if [ "$1" = app-server ]; then exec ${process.execPath} ${join(stage, 'cut.js')} ${cuts} ${forks} ${join(import.meta.dir, '../../../external-harnesses/testing/fixtures/codex/fork-rpc.json')}; fi`,
                ]
              : []),
          ];
    yield* files.writeFileString(
      join(bin, binary),
      [...answering, `exec ${process.execPath} ${join(stage, 'tui.js')} ${report} ${keys} "$@"`].join('\n'),
      { mode: 0o755 },
    );
    const cli = yield* rig.raised({ name, type: `harness:${harness}`, transcript: '', seeded: false });
    if (harness !== 'claude-code')
      yield* cli.store.change(cli.threadId, (facet) => Effect.succeed({ facet: { ...facet, home: stage }, value: undefined }));
    const transcript = join(stage, `${name}.jsonl`);
    yield* files.writeFileString(transcript, '');
    const screen = Effect.gen(function* () {
      const execution = (yield* cli.facet())?.execution;
      if (execution === null || execution === undefined) return null;
      const record = yield* Context.get(world.runtime.owners, Terminals).record(execution.execution, execution.incarnation);
      if (record === null) return null;
      const update = yield* Context.get(world.runtime.owners, TerminalScreens).screen(record.execution);
      return update._tag === 'ScreenTextFrame' ? screenLines(update) : null;
    });
    return {
      cli,
      keys,
      transcript,
      shown: (text: string) =>
        settledOn(Effect.map(screen, (lines) => (lines?.some((line) => line.includes(text)) === true ? true : null))),
      boots: () => linesOf<readonly string[]>(files, report),
      events: () => linesOf<TuiEvent>(files, `${keys}.events`),
      draft: (text: string) => files.writeFileString(`${keys}.draft`, text),
      undraft: () => files.remove(`${keys}.draft`, { force: true }),
      linger: () => files.writeFileString(`${keys}.linger`, ''),
      unlinger: () => files.remove(`${keys}.linger`, { force: true }),
      record: (line: Record<string, unknown>) =>
        Effect.flatMap(stamp(), (timestamp) =>
          files.writeFileString(transcript, `${JSON.stringify({ timestamp, ...line })}\n`, { flag: 'a' }),
        ),
    };
  });

  return {
    world,
    rig,
    flow,
    projectId,
    stage,
    claude: (name: string) => raised(name, 'claude-code'),
    vendor: raised,
    cuts: () => linesOf<CutAsked>(files, cuts),
    holdCuts: () => Effect.andThen(files.makeDirectory(forks, { recursive: true }), files.writeFileString(join(forks, 'hold'), '')),
    cutsHeld: () => Effect.map(files.readDirectory(forks), (names) => names.filter((name) => name.startsWith('waiting-')).length),
    releaseCuts: () => files.remove(join(forks, 'hold'), { force: true }),
    addresses: (addresses: readonly (string | null)[]) =>
      Effect.andThen(
        files.makeDirectory(forks, { recursive: true }),
        files.writeFileString(join(forks, 'turns.json'), JSON.stringify(addresses)),
      ),
  };
});

export type TerminalHistoryWorld = Effect.Success<typeof terminalHistoryWorld>;
export type HistoryClaude = Effect.Success<ReturnType<TerminalHistoryWorld['claude']>>;

export const settledOn = <A, E, R>(read: Effect.Effect<A | null, E, R>) =>
  Effect.repeat(read, { until: (seen): seen is A => seen !== null, schedule: Schedule.spaced(25) }).pipe(Effect.map((seen) => seen as A));
