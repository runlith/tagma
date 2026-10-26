import { expect } from 'bun:test';
import { world } from '@runlith/testbed/worlds';
import { SandboxResources, sandboxResources } from '../sandboxFixture.js';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { createTools } from '@runlith/agent-tools';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { ToolAnswer, toolExecute, toolPrepare, type Tool } from '@runlith/agent/tool';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { unthreadedCaller } from '../callers.js';
import { rootFixture } from '../graphFixture.js';
import {
  buildGuestImage,
  dockerSuite,
  dockerGuestWorld,
  dockerSaid,
  guestRunCommand,
  GUEST_TREE,
} from '../../../sandbox/testing/doubles.js';

const call = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  const execute = toolExecute(tool);
  if (execute === null) return yield* Effect.die('the tool declares no execution');
  const toolCallId = `call-${crypto.randomUUID()}`;
  const prepare = toolPrepare(tool);
  const resolved = prepare === null ? undefined : yield* prepare(input, { toolCallId, caller: unthreadedCaller });
  const answer = yield* execute(input, { toolCallId, caller: unthreadedCaller, messages: [], prepared: resolved?.prepared });
  return String(answer instanceof ToolAnswer ? answer.value : answer);
});
const makeDockerWorld = Effect.gen(function* () {
  const { context } = yield* SandboxResources;
  const files = Context.get(context, FileSystem.FileSystem);
  const roots = yield* Effect.acquireRelease(Effect.sync(rootFixture), (root) => Effect.orDie(root.releaseEffect));
  const fixture = yield* roots.openEffect.pipe(Effect.provide(context));
  const sentinelText = `host-sentinel-${crypto.randomUUID()}`;
  const sentinel = join(yield* fixture.directory('host'), 'host-secret.txt');
  yield* files.writeFileString(sentinel, `${sentinelText}\n`);
  const image = yield* buildGuestImage(undefined).pipe(Effect.provide(context));
  const suite = `tagma-iso-${crypto.randomUUID()}`;
  const made: string[] = [];
  yield* fixture.producer(
    'Docker workloads',
    Effect.gen(function* () {
      if (made.length === 0) return;
      yield* dockerSaid(['rm', '--force', ...made], 'remove the test guests');
      yield* dockerSaid(['volume', 'rm', '--force', ...made], 'remove the test volumes');
    }).pipe(Effect.provide(context)),
  );
  const startGuest = Effect.fnUntraced(
    function* (what: string) {
      const name = `${suite}-${what}`;
      made.push(name);
      const volume = yield* dockerSaid(['volume', 'create', name], 'create a test volume');
      expect(volume.code, volume.output).toBe(0);
      const started = yield* dockerSaid(
        guestRunCommand({
          name,
          image: image.reference,
          volume: name,
          limits: { pids: 128, memory: '512m', cpus: '1' },
          marks: { installation: 'dockerworld-itest', kind: 'workload', subject: name },
          network: 'none',
        }),
        'start a test guest',
      );
      expect(started.code, started.output).toBe(0);
      return name;
    },
    (effect, _what: string) => Effect.provide(effect, context),
  );
  const toolsOver = Effect.fnUntraced(
    function* (container: string) {
      const { world } = yield* dockerGuestWorld({ container });
      return createTools({ cwd: GUEST_TREE(), world, commandTimes: unruledTimes, searchMs: LONGEST_ACT_MS });
    },
    (effect, _container: string) => Effect.provide(effect, context),
  );
  const container = yield* startGuest('main');
  const tools = yield* toolsOver(container);
  return { context, suite, sentinel, sentinelText, tools, startGuest, toolsOver };
});
class DockerFixture extends Context.Service<DockerFixture, Effect.Success<typeof makeDockerWorld>>()('testing/DockerFixture') {}

dockerSuite('Docker world', () => {
  const fixture = Layer.effect(DockerFixture, makeDockerWorld).pipe(Layer.provide(world(sandboxResources, { source: 'empty' })));
  layer(fixture, { excludeTestServices: true, timeout: '60 seconds' })('resources', (it) => {
    it.effect(
      'typed files and the guest shell observe each other’s writes',
      () =>
        DockerFixture.use((world) =>
          Effect.gen(function* () {
            yield* call(world.tools.bash, {
              command: 'echo from the guest shell | tee shell-made.txt',
              description: 'write from the shell',
            });
            expect(yield* call(world.tools.read, { path: 'shell-made.txt' })).toContain('from the guest shell');
            yield* call(world.tools.write, { path: 'typed-made.txt', content: 'from the typed door\n' });
            expect(yield* call(world.tools.bash, { command: 'cat typed-made.txt', description: 'read the typed write' })).toContain(
              'from the typed door',
            );
          }),
        ),
      60_000,
    );

    it.effect(
      'the world describes the guest operating system, user and directory',
      () =>
        DockerFixture.use((world) =>
          Effect.gen(function* () {
            const said = yield* call(world.tools.bash, {
              command: 'uname -s; id -u; echo "$PWD"',
              description: 'ask the guest what it is',
            });
            expect(said).toContain('Linux');
            expect(said).toContain('65534');
            expect(said).toContain(GUEST_TREE());
          }),
        ),
      60_000,
    );

    it.effect(
      'host paths, traversal and links cannot read or search host bytes',
      () =>
        DockerFixture.use((world) =>
          Effect.gen(function* () {
            expect((yield* call(world.tools.read, { path: world.sentinel }).pipe(Effect.flip))._tag).toBe('Tool.Failed');
            expect(
              yield* call(world.tools.bash, {
                command: `cat ${world.sentinel} 2>&1; echo "exit=$?"`,
                description: 'reach for the host secret',
              }),
            ).not.toContain(world.sentinelText);
            const climbed = yield* Effect.result(call(world.tools.read, { path: '../../../../../../etc/hostname' }));
            if (climbed._tag === 'Success') expect(climbed.success).not.toContain(world.sentinelText);
            else expect(climbed.failure._tag).toBe('Tool.Failed');
            yield* call(world.tools.bash, {
              command: `ln -sfn ${world.sentinel} planted-link`,
              description: 'plant a link at the host secret',
            });
            expect(yield* call(world.tools.read, { path: 'planted-link' })).not.toContain(world.sentinelText);
            expect(yield* call(world.tools.grep, { pattern: world.sentinelText.slice(0, 12), output_mode: 'content' })).not.toContain(
              world.sentinelText,
            );
            expect(yield* call(world.tools.glob, { pattern: '**/host-secret.txt' })).not.toContain('host-secret.txt');
          }),
        ),
      60_000,
    );

    it.effect(
      'a deadline ends descendants holding output without stopping another guest’s workload',
      () =>
        DockerFixture.use((world) =>
          Effect.gen(function* () {
            const peer = yield* world.startGuest('peer');
            const peerTools = yield* world.toolsOver(peer);
            yield* call(peerTools.bash, {
              command: 'nohup sleep 300 >/dev/null 2>&1 & echo $! > /work/peer.pid',
              description: 'start the peer workload',
            });
            yield* call(world.tools.bash, {
              command: '(while true; do echo beat; sleep 0.05; done) & echo $! > /work/beat.pid; sleep 300',
              description: 'a command whose descendant holds output',
              lifeMs: 1_000,
            });
            const state = (file: string) =>
              `pid=$(cat ${file}); state=$(awk '{print $3}' /proc/$pid/stat 2>/dev/null); if [ -z "$state" ] || [ "$state" = Z ]; then echo STOPPED; else echo RUNNING; fi`;
            expect(
              yield* call(world.tools.bash, { command: state('/work/beat.pid'), description: 'read the descendant’s kernel state' }),
            ).toContain('STOPPED');
            expect(
              yield* call(peerTools.bash, { command: state('/work/peer.pid'), description: 'read the peer’s kernel state' }),
            ).toContain('RUNNING');
          }),
        ),
      60_000,
    );

    it.effect(
      'guest git and loopback work while external network access is refused',
      () =>
        DockerFixture.use((world) =>
          Effect.gen(function* () {
            expect(
              yield* call(world.tools.bash, {
                command:
                  'git init -q fixture && cd fixture && git -c user.email=a@b -c user.name=a commit -q --allow-empty -m first && git log --oneline',
                description: 'make a fixture repository',
              }),
            ).toContain('first');
            expect(
              yield* call(world.tools.bash, {
                command: `bun -e 'const s=Bun.serve({port:0,fetch:()=>new Response("loopback ok")}); const r=await fetch("http://127.0.0.1:"+s.port); console.log(await r.text()); s.stop()'`,
                description: 'reach the guest loopback',
              }),
            ).toContain('loopback ok');
            expect(
              yield* call(world.tools.bash, {
                command: `bun -e 'try { await fetch("https://example.com", { signal: AbortSignal.timeout(4000) }); console.log("REACHED"); } catch (e) { console.log("refused:", String(e).slice(0, 60)); }'`,
                description: 'try to leave the guest',
              }),
            ).not.toContain('REACHED');
          }),
        ),
      60_000,
    );

    it.effect(
      'a typed write survives stopping and resuming the guest',
      () =>
        DockerFixture.use((world) =>
          Effect.gen(function* () {
            const durable = yield* world.startGuest('durable');
            const first = yield* world.toolsOver(durable);
            yield* call(first.write, { path: 'durable.txt', content: 'still here\n' });
            const stopped = yield* dockerSaid(['stop', durable], 'stop the guest');
            expect(stopped.code, stopped.output).toBe(0);
            const restarted = yield* dockerSaid(['start', durable], 'resume the guest');
            expect(restarted.code, restarted.output).toBe(0);
            const second = yield* world.toolsOver(durable);
            expect(yield* call(second.read, { path: 'durable.txt' })).toContain('still here');
          }).pipe(Effect.provide(world.context)),
        ),
      60_000,
    );

    it.effect(
      'an inaccessible guest refuses instead of falling back to the host',
      () =>
        DockerFixture.use((world) =>
          Effect.gen(function* () {
            const refused = yield* dockerGuestWorld({ container: `${world.suite}-absent` }).pipe(Effect.flip);
            expect(refused._tag).toBe('GuestUnavailable');
          }).pipe(Effect.provide(world.context)),
        ),
      60_000,
    );
  });
});
