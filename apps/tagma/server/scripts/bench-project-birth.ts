import { Context, Effect, Tracer } from 'effect';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { spawnedEffect } from '../src/platform/testing/spawn.js';

const { makeDoorWorld } = await import('../src/composition/testing/doorFixture.js');
type ConnectionReading = {
  readonly at: number;
  readonly pid: number;
  readonly lane: number | undefined;
  readonly purpose: string;
  readonly firstSeen: boolean;
};
type SpanReading = {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly startCpu: number;
  readonly endCpu: number;
  readonly attrs: Record<string, unknown>;
};

const connects: ConnectionReading[] = [];
const pids = new Set<number>();
const connect = ProcessPool.prototype.connect;
ProcessPool.prototype.connect = function (...args) {
  const channel = connect.apply(this, args);
  connects.push({
    at: performance.now(),
    pid: channel.pid,
    lane: args[0],
    purpose: args[4] ?? 'writer',
    firstSeen: !pids.has(channel.pid),
  });
  pids.add(channel.pid);
  return channel;
};

const traces: SpanReading[] = [];
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const world = yield* makeDoorWorld({ own: 'the benchmark releases its world after the samples' });
      const context = yield* world.runtime.runtime.contextEffect;
      const tracer = Context.get(context, Tracer.Tracer);
      const original = tracer.span.bind(tracer);
      let active = false;
      tracer.span = (options) => {
        const span = original(options);
        if (!active) return span;
        const start = performance.now();
        const cpu = process.cpuUsage();
        const end = span.end.bind(span);
        span.end = (at, exit) => {
          const used = process.cpuUsage(cpu);
          traces.push({
            name: span.name,
            start,
            end: performance.now(),
            startCpu: (cpu.user + cpu.system) / 1000,
            endCpu: (cpu.user + cpu.system + used.user + used.system) / 1000,
            attrs: Object.fromEntries(span.attributes),
          });
          end(at, exit);
        };
        return span;
      };
      for (let i = 0; i < 3; i++) {
        const root = yield* world.directory('profile');
        yield* spawnedEffect(['git', 'init', '-q', '-b', 'main'], { cwd: root });
        traces.length = 0;
        const start = performance.now();
        const cpu = process.cpuUsage();
        active = true;
        const response = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
        active = false;
        const used = process.cpuUsage(cpu);
        const wall = performance.now() - start;
        const phases = traces.filter((span) =>
          ['ProjectLifecycle.create', 'GraphPool.open', 'installCatalogs', 'Graph.projectToTree'].includes(span.name),
        );
        const copyStart = traces.find((span) => span.attrs['db.query.text'] === 'PRAGMA foreign_keys = OFF');
        const copyEnd =
          copyStart === undefined
            ? undefined
            : traces.find((span) => span.start >= copyStart.end && span.attrs['db.query.text'] === 'PRAGMA foreign_keys = ON');
        if (copyStart && copyEnd) phases.push({ ...copyStart, name: 'mirror.transfer', end: copyEnd.end, endCpu: copyEnd.endCpu });
        const boundaries = [
          { at: start, cpu: (cpu.user + cpu.system) / 1000 },
          ...phases.flatMap((span) => [
            { at: span.start, cpu: span.startCpu },
            { at: span.end, cpu: span.endCpu },
          ]),
          { at: start + wall, cpu: (cpu.user + cpu.system + used.user + used.system) / 1000 },
        ].sort((a, b) => a.at - b.at);
        const partition = new Map<string, number>();
        for (let at = 1; at < boundaries.length; at++) {
          const left = boundaries[at - 1]!;
          const right = boundaries[at]!;
          const middle = (left.at + right.at) / 2;
          const phase =
            phases.filter((span) => span.start <= middle && span.end >= middle).sort((a, b) => a.end - a.start - (b.end - b.start))[0]
              ?.name ?? 'other';
          partition.set(phase, (partition.get(phase) ?? 0) + right.cpu - left.cpu);
        }
        const git = traces.filter((span) => span.name === 'Git.spawn');
        const verbs = new Map<string, number>();
        for (const span of git) {
          const verb = String(span.attrs['git.verb']);
          verbs.set(verb, (verbs.get(verb) ?? 0) + 1);
        }
        console.log(
          JSON.stringify({
            sample: i,
            status: response.status,
            wall,
            cpu: (used.user + used.system) / 1000,
            phases: Object.fromEntries(partition),
            git: { count: git.length, verbs: Object.fromEntries(verbs), wall: git.reduce((sum, span) => sum + span.end - span.start, 0) },
            sqlite: {
              coverage: 'runtime-tracer statements only; mirror initialization and disposal SQL are excluded',
              connects: connects.filter((item) => item.at >= start),
              count: traces.filter((span) => span.name === 'sql.execute').length,
              exec: traces
                .filter((span) => span.name === 'sql.execute')
                .reduce((sum, span) => sum + Number(span.attrs['db.exec.ms'] ?? 0), 0),
              wall: traces.filter((span) => span.name === 'sql.execute').reduce((sum, span) => sum + span.end - span.start, 0),
            },
            body: response.status === 200 ? undefined : response.body,
          }),
        );
        if (response.status !== 200) return yield* Effect.die(new Error(`add_project answered ${response.status}`));
      }
    }),
  ),
);
