import { hostname } from 'node:os';
import { Clock, Data, Deferred, Effect, Stream } from 'effect';
import type { Cause } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import type {
  EvidenceNamespace,
  EvidenceScope,
  EvidenceSource,
  ListenerSnapshot,
  ProcessSnapshot,
  UnmeasuredRegion,
} from '@runlith/executions/protocol/evidence';
import { EvidenceReader, type Measured } from '../../EvidenceScans';
import { Processes, type ProcessIdentity, type ProcessesUnreadable, type ProcessProbe } from '../../ProcessReader';
import { sameProcess } from '@runlith/executions/protocol/evidence';

const ADAPTER = 'darwin';

export const PS = '/bin/ps';
export const LSOF = '/usr/sbin/lsof';

export type ProbeLimits = {
  readonly outputBytes: number;
  readonly errorBytes: number;
};

type EvidenceLimits = ProbeLimits & { readonly probeMs: number };

const PID_CEILING = 99_999;

const PROBE_ENV = { TZ: 'UTC', LC_ALL: 'C' };
class ProbeFailed extends Data.TaggedError('ProbeFailed')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

export const evidenceProbe = Effect.fnUntraced(function* (limits: EvidenceLimits) {
  const reader = yield* Processes;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const machine: EvidenceNamespace = { _tag: 'Local', machine: hostname() };
  const scope: EvidenceScope = { host: machine, network: machine };
  const privileged = process.getuid?.() === 0;
  const clock = yield* Clock.Clock;
  const unavailable = (unmeasured: ReadonlyArray<UnmeasuredRegion>, observedAt = clock.currentTimeMillisUnsafe()): Measured<never> => ({
    observedAt,
    completeness: 'unavailable',
    unmeasured,
    found: [],
  });

  const read = (program: string, args: ReadonlyArray<string>) =>
    command(program, args, limits).pipe(
      Effect.timeout(limits.probeMs),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

  const identities = (request: ProcessProbe): Effect.Effect<ReadonlyMap<number, ProcessIdentity>, ProcessesUnreadable> =>
    Effect.map(reader.scan(request), (rows) => new Map(rows.map((row) => [row.pid, { ...row, _tag: 'Read' as const }])));

  return EvidenceReader.of({
    scope,
    processes: Effect.fn('posix.evidence.processes')(
      function* (request) {
        const source: EvidenceSource = { adapter: ADAPTER, probe: 'ps' };
        const asked = request._tag === 'Pids' ? request.pids : [];
        const usable = asked.filter(addressable);
        const refused = asked.filter((pid) => !addressable(pid));
        const beyondCeiling: ReadonlyArray<UnmeasuredRegion> =
          refused.length === 0
            ? []
            : [
                {
                  region: `pids ${refused.join(', ')}`,
                  reason: 'unsupported',
                  detail: `this kernel numbers processes up to ${PID_CEILING}`,
                },
              ];
        if (request._tag === 'Pids' && usable.length === 0) {
          const observedAt = yield* Clock.currentTimeMillis;
          return unavailable(
            [...beyondCeiling, { region: named(request), reason: 'unknown', detail: 'no pid of this question could be asked about' }],
            observedAt,
          );
        }
        const question: ProcessProbe = request._tag === 'Pids' ? { _tag: 'Pids', pids: usable } : request;
        const before = yield* identities(question).pipe(
          Effect.mapError((failure) => unavailable([{ region: named(request), reason: 'failed', detail: failure.detail }])),
        );
        const region = named(request);
        const output = yield* read(PS, listing(request, PS_FIELDS, usable)).pipe(
          Effect.mapError((failure) => unavailable([...beyondCeiling, broke(region, failure, limits)])),
        );
        const observedAt = yield* Clock.currentTimeMillis;
        const after = yield* identities(question).pipe(
          Effect.mapError((failure) => unavailable([...beyondCeiling, { region, reason: 'failed', detail: failure.detail }], observedAt)),
        );
        const rows = whole(output)
          .split('\n')
          .filter((line) => line.trim() !== '');
        const changed: UnmeasuredRegion[] = [];
        const found = rows
          .map((line) => {
            const pid = Number(line.trim().split(/\s+/, 1)[0]);
            if (!addressable(pid)) return undefined;
            const earlier = before.get(pid);
            const current = after.get(pid);
            if (
              earlier?._tag !== 'Read' ||
              current?._tag !== 'Read' ||
              !sameProcess(earlier, current) ||
              earlier.parent !== current.parent ||
              earlier.work !== current.work ||
              earlier.zombie !== current.zombie
            ) {
              changed.push({
                region: `the identity and facts of pid ${pid}`,
                reason: 'unknown',
                detail: current?._tag === 'Unreadable' ? current.detail : 'the process changed or left while its listing was being read',
              });
              return undefined;
            }
            return processRow(line, scope, source, observedAt, current);
          })
          .filter(present);
        const unreadable = rows.length - found.length - changed.length;
        const unmeasured = [
          ...beyondCeiling,
          ...around(region, output, limits),
          ...changed,
          ...(unreadable === 0
            ? []
            : [
                {
                  region: `${unreadable} rows of the process listing`,
                  reason: 'failed' as const,
                  detail: 'the row did not carry the fields this reading asks for',
                },
              ]),
        ];
        return {
          observedAt,
          completeness: broken(output) && found.length === 0 ? 'unavailable' : complete(unmeasured),
          unmeasured,
          found,
        } satisfies Measured<ProcessSnapshot>;
      },
      Effect.match({ onFailure: (unavailable) => unavailable, onSuccess: (measured) => measured }),
    ),

    listeners: Effect.fn('posix.evidence.listeners')(
      function* (request) {
        const source: EvidenceSource = { adapter: ADAPTER, probe: 'lsof' };
        const region =
          request._tag === 'Inventory'
            ? 'the listening sockets of this namespace'
            : `the listening sockets of pids ${request.pids.join(', ')}`;
        const asked = request._tag === 'Held' ? request.pids : [];
        const usable = asked.filter(addressable);
        const refused = asked.filter((pid) => !addressable(pid));
        const unreachable: ReadonlyArray<UnmeasuredRegion> =
          refused.length === 0
            ? []
            : [
                {
                  region: `the sockets of pids ${refused.join(', ')}`,
                  reason: 'unsupported',
                  detail: `this kernel numbers processes up to ${PID_CEILING}`,
                },
              ];
        const datagrams: ReadonlyArray<UnmeasuredRegion> = [
          { region: 'udp sockets', reason: 'unsupported', detail: 'this reading asks the socket table for listening TCP sockets alone' },
        ];
        if (request._tag === 'Held' && usable.length === 0) {
          const observedAt = yield* Clock.currentTimeMillis;
          return unavailable(
            [...unreachable, ...datagrams, { region, reason: 'unknown', detail: 'no process of this question could be asked about' }],
            observedAt,
          );
        }
        const question: ProcessProbe = request._tag === 'Held' ? { _tag: 'Pids', pids: usable } : { _tag: 'Table' };
        const standing = [...unreachable, ...datagrams];
        const before = yield* identities(question).pipe(
          Effect.mapError((failure) => unavailable([...standing, { region, reason: 'failed', detail: failure.detail }])),
        );
        const args = request._tag === 'Inventory' ? LSOF_FIELDS : [...LSOF_FIELDS, '-a', '-p', usable.join(',')];
        const output = yield* read(LSOF, args).pipe(
          Effect.mapError((failure) => unavailable([...standing, broke(region, failure, limits)])),
        );
        const observedAt = yield* Clock.currentTimeMillis;
        const after = yield* identities(question).pipe(
          Effect.mapError((failure) => unavailable([...standing, { region, reason: 'failed', detail: failure.detail }], observedAt)),
        );
        const table = sockets(whole(output), scope, source, observedAt);
        const changed: UnmeasuredRegion[] = [];
        const found = table.found.flatMap((socket) => {
          const pid = socket.holder.pid;
          const earlier = before.get(pid);
          const current = after.get(pid);
          if (earlier?._tag !== 'Read' || current?._tag !== 'Read' || !sameProcess(earlier, current)) {
            changed.push({
              region: `the holder of port ${socket.port}`,
              reason: 'unknown',
              detail: 'the process changed or left while its sockets were being read',
              port: socket.port,
            });
            return [];
          }
          return [{ ...socket, holder: { pid, birth: current.birth } }];
        });
        const others =
          request._tag === 'Inventory' && !privileged
            ? yield* read(NETSTAT, NETSTAT_ARGS).pipe(
                Effect.match({
                  onFailure: (failure) => [OTHER_USERS, broke(OTHER_USERS.region, failure, limits)],
                  onSuccess: (listing) => {
                    const gaps = around(OTHER_USERS.region, listing, limits);
                    if (gaps.length > 0) return [OTHER_USERS, ...gaps];
                    const { hidden, unreadable } = hiddenListeners(listing.text, table.endpoints);
                    return [
                      ...(unreadable === 0
                        ? []
                        : [{ ...OTHER_USERS, detail: `${unreadable} listening entries of the full socket table could not be read` }]),
                      ...[...hidden].map(([port, addresses]) => ({
                        region: `listening sockets of other users on port ${port}`,
                        reason: 'refused' as const,
                        detail: `the full socket table lists ${addresses.join(', ')}; the process table answers this user its own processes alone`,
                        port,
                      })),
                    ];
                  },
                }),
              )
            : [];
        const unmeasured = [
          ...standing,
          ...others,
          ...changed,
          ...around(region, output, limits),
          ...(table.unreadable === 0
            ? []
            : [
                {
                  region: `${table.unreadable} entries of the socket table`,
                  reason: 'failed' as const,
                  detail: 'the entry did not carry the address, protocol and state this reading confirms a listener by',
                },
              ]),
        ];
        return {
          observedAt,
          completeness: broken(output) && found.length === 0 ? 'unavailable' : complete(unmeasured),
          unmeasured,
          found,
        } satisfies Measured<ListenerSnapshot>;
      },
      Effect.match({ onFailure: (unavailable) => unavailable, onSuccess: (measured) => measured }),
    ),
  });
});

const PS_FIELDS = 'pid=,ppid=,pgid=,tty=,stat=,command=';
const LSOF_FIELDS = ['-nP', '-w', '-FpcnPTt', '-iTCP', '-sTCP:LISTEN'];
const NETSTAT = '/usr/sbin/netstat';
const NETSTAT_ARGS = ['-anp', 'tcp'];

const OTHER_USERS: UnmeasuredRegion = {
  region: 'sockets held by other users',
  reason: 'refused',
  detail: 'the socket table answers this user its own processes alone, and the full socket table could not be read',
};

const addressable = (pid: number): boolean => Number.isInteger(pid) && pid > 0 && pid <= PID_CEILING;

const named = (request: ProcessProbe): string =>
  request._tag === 'Table'
    ? 'every process on this machine'
    : request._tag === 'Terminal'
      ? `the processes attached to ${request.terminal}`
      : `the processes ${request.pids.join(', ')}`;

const listing = (request: ProcessProbe, fields: string, usable: ReadonlyArray<number>): ReadonlyArray<string> =>
  request._tag === 'Table'
    ? ['-Ao', fields]
    : request._tag === 'Terminal'
      ? ['-o', fields, '-t', request.terminal]
      : ['-o', fields, '-p', usable.join(',')];

const complete = (unmeasured: ReadonlyArray<UnmeasuredRegion>): 'complete' | 'partial' =>
  unmeasured.length === 0 ? 'complete' : 'partial';

const broke = (region: string, failure: ProbeFailed | Cause.TimeoutError, limits: EvidenceLimits): UnmeasuredRegion =>
  failure._tag === 'TimeoutError'
    ? { region, reason: 'timeout', detail: `the reading did not answer inside ${limits.probeMs} ms` }
    : { region, reason: 'failed', detail: failure.detail };

const around = (region: string, output: Output, limits: ProbeLimits): ReadonlyArray<UnmeasuredRegion> => [
  ...(output.failed === undefined ? [] : [{ region, reason: 'refused' as const, detail: output.failed }]),
  ...(output.signalled ? [{ region, reason: 'failed' as const, detail: 'a signal ended this reading before it finished' }] : []),
  ...(output.truncated
    ? [{ region, reason: 'truncated' as const, detail: `the reading was read to ${limits.outputBytes} bytes and stopped` }]
    : []),
];

export const broken = (output: Output): boolean => output.failed !== undefined || output.signalled;

const whole = (output: Output): string => {
  if (!output.truncated && output.exitCode !== undefined) return output.text;
  const last = output.text.lastIndexOf('\n');
  return last < 0 ? '' : output.text.slice(0, last + 1);
};

const present = <A>(value: A | undefined): value is A => value !== undefined;

const processRow = (
  line: string,
  scope: EvidenceScope,
  source: EvidenceSource,
  observedAt: number,
  read: Extract<ProcessIdentity, { readonly _tag: 'Read' }>,
): ProcessSnapshot | undefined => {
  const fields = line.trim().split(/\s+/);
  if (fields.length < 5) return undefined;
  const [pid, , , terminal, state] = fields as [string, string, string, string, string];
  const identity = Number(pid);
  if (!addressable(identity)) return undefined;
  const command = fields.slice(5).join(' ');
  return {
    scope,
    source,
    observedAt,
    completeness: 'complete',
    unmeasured: [],
    identity: { pid: read.pid, birth: read.birth },
    parent: addressable(read.parent) ? read.parent : undefined,
    work: addressable(read.work) ? read.work : undefined,
    terminal: terminal === '??' || terminal === '' ? undefined : terminal,
    state: state === '' ? undefined : state,
    command: command === '' ? undefined : command,
  };
};

const sockets = (
  text: string,
  scope: EvidenceScope,
  source: EvidenceSource,
  observedAt: number,
): {
  readonly found: ReadonlyArray<ListenerSnapshot>;
  readonly unreadable: number;
  readonly endpoints: ReadonlySet<string>;
} => {
  const found: ListenerSnapshot[] = [];
  const endpoints = new Set<string>();
  let unreadable = 0;
  let holder: number | undefined;
  let open = false;
  let address: string | undefined;
  let protocol: string | undefined;
  let family: string | undefined;
  let listening = false;

  const close = () => {
    if (!open) return;
    open = false;
    const bound = address === undefined ? undefined : endpoint(address);
    if (protocol?.toUpperCase() !== 'TCP' || !listening || holder === undefined || bound === undefined) {
      unreadable += 1;
      return;
    }
    endpoints.add(endpointKey(family === 'IPv4' ? '4' : '6', bound.address, bound.port));
    found.push({
      scope,
      source,
      observedAt,
      completeness: 'complete',
      unmeasured: [],
      protocol: 'tcp',
      address: bound.address,
      port: bound.port,
      holder: { pid: holder },
    });
  };

  for (const line of text.split('\n')) {
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') {
      close();
      const pid = Number(value);
      holder = addressable(pid) ? pid : undefined;
      continue;
    }
    if (field === 'f') {
      close();
      open = true;
      address = undefined;
      protocol = undefined;
      family = undefined;
      listening = false;
      continue;
    }
    if (field === 'n') address = value;
    if (field === 'P') protocol = value;
    if (field === 't') family = value;
    if (field === 'T' && value === 'ST=LISTEN') listening = true;
  }
  close();
  return { found, unreadable, endpoints };
};

const endpointKey = (family: '4' | '6', address: string, port: number): string => `${family}|${address}|${port}`;

const hiddenListeners = (
  text: string,
  seen: ReadonlySet<string>,
): { readonly hidden: ReadonlyMap<number, ReadonlyArray<string>>; readonly unreadable: number } => {
  const hidden = new Map<number, string[]>();
  let unreadable = 0;
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/);
    const [kind, , , local, , state] = fields;
    if (kind === undefined || !kind.startsWith('tcp') || state !== 'LISTEN') continue;
    const cut = local === undefined ? -1 : local.lastIndexOf('.');
    const port = local === undefined ? NaN : Number(local.slice(cut + 1));
    const address = local === undefined ? '' : local.slice(0, cut);
    if (cut <= 0 || !Number.isInteger(port) || port < 1 || port > 65535 || address === '') {
      unreadable += 1;
      continue;
    }
    if (seen.has(endpointKey(kind === 'tcp4' ? '4' : '6', address, port))) continue;
    hidden.set(port, [...(hidden.get(port) ?? []), address]);
  }
  return { hidden, unreadable };
};

const endpoint = (name: string): { readonly address: string; readonly port: number } | undefined => {
  const cut = name.lastIndexOf(':');
  if (cut <= 0) return undefined;
  const port = Number(name.slice(cut + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  const address = name.slice(0, cut);
  const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  return bare === '' ? undefined : { address: bare, port };
};

type Output = {
  readonly text: string;
  readonly failed: string | undefined;
  readonly truncated: boolean;
  readonly signalled: boolean;
  readonly exitCode: number | undefined;
};

export const command = Effect.fn('posix.evidence.command')(
  function* (program: string, args: ReadonlyArray<string>, limits: ProbeLimits) {
    const handle = yield* ChildProcess.make(program, args, {
      cwd: '/',
      env: PROBE_ENV,
      extendEnv: false,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      killSignal: 'SIGKILL',
    });
    const cut = yield* Deferred.make<void>();
    const stdout = capture(handle.stdout, limits.outputBytes, cut);
    const stderr = capture(handle.stderr, limits.errorBytes, cut);
    yield* Effect.raceFirst(Effect.all([stdout.read, stderr.read], { concurrency: 2 }), Deferred.await(cut));
    const out = stdout.output();
    const failed = stderr.output();
    const ended = out.truncated || failed.truncated ? undefined : yield* Effect.result(handle.exitCode);
    const detail = failed.text.trim();
    return {
      text: out.text,
      failed: failed.truncated ? `${detail} (read to ${limits.errorBytes} bytes and stopped)` : detail === '' ? undefined : detail,
      truncated: out.truncated,
      signalled: ended !== undefined && ended._tag === 'Failure',
      exitCode: ended?._tag === 'Success' ? ended.success : undefined,
    };
  },
  (effect, program) => Effect.mapError(effect, (error) => new ProbeFailed({ detail: `${program}: ${error.message}` })),
  Effect.scoped,
);

const capture = <E, R>(stream: Stream.Stream<Uint8Array, E, R>, cap: number, cut: Deferred.Deferred<void>) => {
  const held: Uint8Array[] = [];
  let taken = 0;
  return {
    read: Stream.runForEachWhile(stream, (chunk) =>
      Effect.sync(() => {
        if (taken < cap) held.push(chunk.subarray(0, cap - taken));
        taken += chunk.length;
        return taken <= cap;
      }),
    ).pipe(Effect.tap(() => (taken > cap ? Deferred.succeed(cut, undefined) : Effect.void))),
    output: () => ({ text: Buffer.concat(held).toString('utf8'), truncated: taken > cap }),
  };
};
