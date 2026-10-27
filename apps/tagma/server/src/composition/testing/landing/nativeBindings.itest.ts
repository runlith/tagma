import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { join } from 'node:path';
import { nativeLanding } from './native.js';

const HOST = 'export interface Host {\n  firstEnded(): void;\n}\n';
const SUCCESSION = 'export interface Succession {\n  ready: boolean;\n}\n';
const SERVER = [
  'import type { Host } from "./host.js";',
  'import type { Succession } from "./succession.js";',
  'export const phase = (value: number) => value;',
  'export const read = (host: any, refused: any) => {',
  '  host.firstEnded();',
  '  return refused.detail;',
  '};',
  '',
].join('\n');
const BOUND = '\nexport const doorBound = phase(1);\n';
const EXISTING = 'export type Existing = string;\nexport type Other = number;\n';
const IMPORTER =
  'import type {\n  Existing as Imported\n} from "./clean.js";\nimport type * as API\n  from "./clean.js";\nexport type Shape = Imported | API.Other;\n';
const PEER = 'export const marker = 0;\n';

it.live('native change checks and landing judge selected references while HEAD and peer member names remain outside the slice', () =>
  Effect.gen(function* () {
    const { born, doors, write, read, files, root } = yield* nativeLanding(
      { 'host.ts': HOST, 'succession.ts': SUCCESSION, 'server.ts': SERVER, 'clean.ts': EXISTING, 'peer.ts': PEER, 'importer.ts': IMPORTER },
      { tools: ['check_rules', 'submit_work'] },
    );
    const peer = yield* born();
    const caller = yield* born();
    yield* write(peer.threadId, 'host.ts', HOST.replace('firstEnded', 'hostEnded'));
    yield* write(peer.threadId, 'succession.ts', SUCCESSION.replace('  ready', '  detail: string;\n  refused: boolean;\n  ready'));
    const foreign = SERVER.replace('firstEnded', 'hostEnded');
    yield* write(peer.threadId, 'server.ts', foreign);
    yield* write(caller.threadId, 'server.ts', foreign + BOUND);

    expect(yield* doors.atNative('check_rules', { over: 'change' }, caller)).toMatchObject({
      class: 'answer',
      value: { refuses: false },
    });
    expect(yield* doors.atNative('submit_work', { subject: 'bind an independent door' }, caller)).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed', committed: ['server.ts'], carried: [] } },
    });
    expect(yield* read('server.ts')).toBe(SERVER + BOUND);
    expect(yield* read('host.ts')).toBe(HOST);
    expect(yield* read('succession.ts')).toBe(SUCCESSION);
    expect(yield* files.readFileString(join(root, 'server.ts'))).toBe(foreign + BOUND);

    yield* write(caller.threadId, 'server.ts', foreign + BOUND + 'export const use = (host: any) => host.hostEnded();\n');
    yield* write(peer.threadId, 'peer.ts', PEER + EXISTING);
    const shared = IMPORTER + 'export const peerMarker = 1;\n';
    yield* write(peer.threadId, 'importer.ts', shared);
    yield* write(caller.threadId, 'importer.ts', shared.replaceAll('./clean.js', './peer.js'));
    for (const id of ['check_rules', 'submit_work']) {
      const refused = yield* doors.atNative(id, id === 'check_rules' ? { over: 'change' } : { subject: 'use a peer member' }, caller);
      expect(refused).toMatchObject({ class: 'refusal', code: 'lines-held' });
      if (refused.class === 'refusal') {
        expect(refused.reason).toContain(`hostEnded in host.ts:2, held by ${peer.threadId}`);
        expect(refused.reason).toContain(`Existing in peer.ts:2, held by ${peer.threadId}`);
        expect(refused.reason).toContain(`Other in peer.ts:3, held by ${peer.threadId}`);
      }
    }
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
