import { endianness, hostname } from 'node:os';
import { Clock, Effect, FileSystem } from 'effect';
import type {
  EvidenceNamespace,
  EvidenceScope,
  ListenerSnapshot,
  ProcessSnapshot,
  UnmeasuredRegion,
} from '@runlith/executions/protocol/evidence';
import { sameProcess } from '@runlith/executions/protocol/evidence';
import { EvidenceReader, type Measured } from '../../EvidenceScans';
import { Processes, type ProcessRow } from '../../ProcessReader';
import { commandLine } from '../programs';
import { linksOf, statusOf } from './proc';

type Socket = { readonly inode: string; readonly address: string; readonly port: number };
const complete = (unmeasured: readonly UnmeasuredRegion[]) => (unmeasured.length === 0 ? ('complete' as const) : ('partial' as const));
const unavailable = <A>(observedAt: number, region: string, detail: string): Measured<A> => ({
  observedAt,
  completeness: 'unavailable',
  unmeasured: [{ region, reason: 'failed', detail }],
  found: [],
});

const addressOf = (encoded: string): string | undefined => {
  if (!/^(?:[0-9A-F]{8}|[0-9A-F]{32})$/iu.test(encoded)) return undefined;
  const bytes = encoded.match(/.{8}/gu)!.flatMap((word) => {
    const bytes = [...Buffer.from(word, 'hex')];
    return endianness() === 'LE' ? bytes.reverse() : bytes;
  });
  if (bytes.length === 4) return bytes.join('.');
  const groups = Array.from({ length: 8 }, (_, at) => ((bytes[at * 2]! << 8) | bytes[at * 2 + 1]!).toString(16));
  let start = -1;
  let length = 1;
  for (let at = 0; at < groups.length;) {
    if (groups[at] !== '0') {
      at++;
      continue;
    }
    let until = at;
    while (groups[until] === '0') until++;
    if (until - at > length) {
      start = at;
      length = until - at;
    }
    at = until;
  }
  return start < 0 ? groups.join(':') : `${groups.slice(0, start).join(':')}::${groups.slice(start + length).join(':')}`;
};

const socketsOf = (text: string): { readonly sockets: readonly Socket[]; readonly unread: number } => {
  const sockets: Socket[] = [];
  let unread = 0;
  for (const line of text.split('\n').slice(1)) {
    if (line.trim() === '') continue;
    const fields = line.trim().split(/\s+/u);
    if (fields[3] !== '0A') continue;
    const parts = fields[1]?.split(':');
    const address = parts?.[0] === undefined ? undefined : addressOf(parts[0]);
    const port = Number.parseInt(parts?.[1] ?? '', 16);
    const inode = fields[9];
    if (address === undefined || !Number.isInteger(port) || port < 1 || port > 65535 || inode === undefined || !/^[1-9]\d*$/u.test(inode)) {
      unread++;
      continue;
    }
    sockets.push({ address, port, inode });
  }
  return { sockets, unread };
};

export const evidenceProbe = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const reader = yield* Processes;
  const machine: EvidenceNamespace = { _tag: 'Local', machine: hostname() };
  const scope: EvidenceScope = { host: machine, network: machine };
  const source = { adapter: 'linux', probe: '/proc process metadata and socket inode tables' };
  const current = (before: ProcessRow) => {
    const after = reader.identity(before.pid);
    return after._tag === 'Read' && sameProcess(before, after) && before.parent === after.parent && before.work === after.work;
  };
  return EvidenceReader.of({
    scope,
    processes: Effect.fn('posix.evidence.processes')(function* (request) {
      const before = yield* reader.scan(request).pipe(Effect.result);
      const observedAt = yield* Clock.currentTimeMillis;
      if (before._tag === 'Failure') return unavailable<ProcessSnapshot>(observedAt, 'the process population', before.failure.detail);
      const facts = yield* reader.facts(before.success.map((row) => row.pid)).pipe(Effect.result);
      if (facts._tag === 'Failure') return unavailable<ProcessSnapshot>(observedAt, 'the process facts', facts.failure.detail);
      const identities = new Map(before.success.map((row) => [row.pid, row]));
      const found: ProcessSnapshot[] = [];
      const unmeasured: UnmeasuredRegion[] = facts.success.unread.map((row) => ({
        region: `pid ${row.pid}`,
        reason: row._tag === 'Gone' ? 'unknown' : 'refused',
        detail: row._tag === 'Gone' ? 'the process left during the reading' : row.detail,
      }));
      for (const one of facts.success.processes) {
        const earlier = identities.get(one.pid);
        const status = yield* statusOf(one.pid).pipe(Effect.provideService(FileSystem.FileSystem, files), Effect.result);
        if (
          earlier === undefined ||
          !sameProcess(earlier, one) ||
          !current(earlier) ||
          status._tag === 'Failure' ||
          status.success._tag === 'Gone'
        ) {
          unmeasured.push({
            region: `pid ${one.pid}`,
            reason: 'unknown',
            detail: status._tag === 'Failure' ? status.failure.detail : 'the process changed or left during the reading',
          });
          continue;
        }
        if (one.args._tag === 'Unreadable')
          unmeasured.push({ region: `the arguments of pid ${one.pid}`, reason: 'refused', detail: one.args.detail });
        found.push({
          scope,
          source,
          observedAt,
          completeness: 'complete',
          unmeasured: [],
          identity: { pid: one.pid, birth: one.birth },
          parent: one.parent || undefined,
          work: one.work || undefined,
          terminal: request._tag === 'Terminal' ? request.terminal : undefined,
          state: status.success.state,
          command: one.args._tag === 'Read' ? commandLine(one.args.value) : undefined,
        });
      }
      return { observedAt, found, unmeasured, completeness: complete(unmeasured) };
    }),
    listeners: Effect.fn('posix.evidence.listeners')(function* (request) {
      const before = yield* reader
        .scan(request._tag === 'Held' ? { _tag: 'Pids', pids: request.pids } : { _tag: 'Table' })
        .pipe(Effect.result);
      const observedAt = yield* Clock.currentTimeMillis;
      if (before._tag === 'Failure') return unavailable<ListenerSnapshot>(observedAt, 'the socket holders', before.failure.detail);
      const sockets: Socket[] = [];
      const unmeasured: UnmeasuredRegion[] = [
        { region: 'udp sockets', reason: 'unsupported', detail: 'this reading asks the socket table for listening TCP sockets alone' },
      ];
      let tables = 0;
      for (const path of ['/proc/net/tcp', '/proc/net/tcp6']) {
        const read = yield* files.readFileString(path).pipe(Effect.result);
        if (read._tag === 'Failure') {
          unmeasured.push({
            region: path,
            reason: read.failure.reason._tag === 'NotFound' ? 'unsupported' : 'refused',
            detail: read.failure.message,
          });
          continue;
        }
        tables++;
        const parsed = socketsOf(read.success);
        sockets.push(...parsed.sockets);
        if (parsed.unread > 0)
          unmeasured.push({
            region: path,
            reason: 'failed',
            detail: `${parsed.unread} listening entries had no readable endpoint and inode`,
          });
      }
      const held = new Map<string, ProcessRow[]>();
      for (const row of before.success) {
        const links = yield* linksOf(row.pid).pipe(Effect.provideService(FileSystem.FileSystem, files), Effect.result);
        if (!current(row)) {
          unmeasured.push({
            region: `the sockets of pid ${row.pid}`,
            reason: 'unknown',
            detail: 'the process changed or left during the reading',
          });
          continue;
        }
        if (links._tag === 'Failure') {
          unmeasured.push({ region: `the sockets of pid ${row.pid}`, reason: 'refused', detail: links.failure.detail });
          continue;
        }
        for (const inode of new Set(
          links.success.flatMap((link) => {
            const matched = /^socket:\[(\d+)\]$/u.exec(link);
            return matched === null ? [] : [matched[1]!];
          }),
        )) {
          const owners = held.get(inode);
          if (owners === undefined) held.set(inode, [row]);
          else owners.push(row);
        }
      }
      const found: ListenerSnapshot[] = [];
      const hidden = new Map<number, Set<string>>();
      for (const socket of sockets) {
        const owners = held.get(socket.inode) ?? [];
        for (const owner of owners)
          found.push({
            scope,
            source,
            observedAt,
            completeness: 'complete',
            unmeasured: [],
            protocol: 'tcp',
            address: socket.address,
            port: socket.port,
            holder: { pid: owner.pid, birth: owner.birth },
          });
        if (request._tag !== 'Inventory' || owners.length > 0) continue;
        const addresses = hidden.get(socket.port);
        if (addresses === undefined) hidden.set(socket.port, new Set([socket.address]));
        else addresses.add(socket.address);
      }
      for (const [port, addresses] of hidden)
        unmeasured.push({
          region: `listening sockets without a visible owner on port ${port}`,
          port,
          reason: 'refused',
          detail: `the socket table lists ${[...addresses].join(', ')}; no process descriptor this reader can see proved their owner`,
        });
      return { observedAt, found, unmeasured, completeness: tables === 0 ? 'unavailable' : complete(unmeasured) };
    }),
  });
});
