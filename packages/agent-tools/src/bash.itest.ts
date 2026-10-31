import { unthreadedCaller } from './testing/caller';
import { afterAll, expect } from 'bun:test';
import { release } from '@runlith/git/testing';
import { it } from '@runlith/effect-test';
import { lstat } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { basename, join } from 'node:path';
import { TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES } from '@runlith/agent/ToolOutputSpool';
import { ToolAnswer, ToolFailed, toolDisplay, toolExecute } from '@runlith/agent/tool';
import { toolArguments } from '@runlith/agent/tool/arguments';
import type { Raised } from '@runlith/agent/permissions';
import { toolDisplayOpensByDefault, type ToolDisplay } from '@runlith/agent/tool/display';
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import type { Command } from 'effect/process/ChildProcess';
import type { ChildProcessHandle } from 'effect/process/ChildProcessSpawner';
import { ManagedCallTypeId, withManagedCall } from '@runlith/executions/ManagedCall';
import type { CallDecisionAnswer } from '@runlith/executions/protocol/call';
import type { ExecutionRef, HostRequestRef } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import { createTools } from './index';
import { bytesDigest, contentDigest } from '@runlith/files/content';
import { machineWorld } from './world/machine';
import type { FinishedCommand } from './world';
import { options, preparationOf, answer, call, exists, createTempDir, recorder, host, checkout } from './testing/toolHarness';

afterAll(release);

const connectedCommand = Effect.fnUntraced(function* (ignoreInterrupt = false) {
  const connected = yield* Deferred.make<void>();
  const disconnected = yield* Deferred.make<void>();
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
      Deferred.doneUnsafe(disconnected, Effect.void);
    });
    Deferred.doneUnsafe(connected, Effect.void);
  });
  yield* Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', resolve);
        }),
    ),
    () =>
      Effect.promise(
        () =>
          new Promise<void>((resolve, reject) => {
            for (const socket of sockets) socket.destroy();
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
  );
  const address = server.address();
  if (address === null || typeof address === 'string') return yield* Effect.die('the command listener has no TCP address');
  const source = `${ignoreInterrupt ? "process.on('SIGINT', () => {});" : ''} require('node:net').connect(${address.port}, '127.0.0.1');`;
  return {
    command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`,
    connected: Deferred.await(connected),
    disconnected: Deferred.await(disconnected),
  };
});

const sh = (dir: string, command: string, tolerate = false) =>
  Effect.promise(() => {
    const run = Bun.$`sh -c ${command}`.cwd(dir).quiet();
    return tolerate ? run.nothrow() : run;
  });

const shText = (dir: string, command: string) => Effect.map(sh(dir, command), (done) => done.text());

const managedExec = (result: CallDecisionAnswer) => {
  const platform = machineWorld.exec;
  if (platform === undefined) throw new Error('machineWorld binds a spawner');
  return Layer.provide(
    Layer.effect(
      ChildProcessSpawner.ChildProcessSpawner,
      Effect.map(ChildProcessSpawner.ChildProcessSpawner, (inner) => ({
        ...inner,
        spawn: (command: Command) =>
          Effect.map(inner.spawn(command), (handle) =>
            withManagedCall(handle, {
              [ManagedCallTypeId]: ManagedCallTypeId,
              operation: { installation: 'install-test', operation: 'op-test' } as HostRequestRef,
              execution: { installation: 'install-test', execution: 'exec-test', incarnation: 1 } as ExecutionRef,
              result: Effect.succeed(result),
              cancel: () => Effect.void,
            }),
          ),
      })),
    ),
    platform,
  );
};

const timeoutResult: CallDecisionAnswer = {
  _tag: 'Decided',
  decision: {
    _tag: 'Cancelled',
    operation: { installation: 'install-test', operation: 'op-test' } as HostRequestRef,
    execution: { installation: 'install-test', execution: 'exec-test', incarnation: 1 } as ExecutionRef,
    sequence: 0,
    cause: 'timeout',
    trigger: 'deadline at 2026-09-17T00:00:05.000Z (revision 0)',
  },
  sources: {
    stdout: { completed: true, offset: byteOffset(0n) },
    stderr: { completed: true, offset: byteOffset(0n) },
  },
  cleanup: 'complete',
  retention: 'retained',
  cost: { _tag: 'Unmeasured', reason: 'unsupported', detail: 'the test brands no accounting' },
};

const GIT_USER = 'git config user.email a@b.c && git config user.name test';

it.live('a failing command says so, and a passing one does not say it succeeded', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const tools = createTools(options({ cwd: root }));
    const shell = (command: string) =>
      call(tools.bash, { command, description: 'Run one command' }, { toolCallId: 'call-exit', caller: unthreadedCaller });

    const failed = String(yield* shell('echo broke >&2; exit 3'));
    expect(failed).toContain('broke');
    expect(failed).toContain('Command exited with status 3.');

    expect(String(yield* shell('echo fine'))).not.toContain('exited with status');
  }),
);

it.live('bash keeps home-relative single-file rg matches as data even when minified code contains line-site syntax', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const outside = yield* createTempDir();
    const file = join(outside, 'claude');
    const code = `function es(t){${'x'.repeat(1_000)};return t?t?1:2:3;}`;
    yield* host.writeFile(file, code);
    const rg = yield* machineWorld.environment.executables.ripgrep;
    const tools = createTools(options({ cwd: root, allowOutsideCwd: true, env: { HOME: root }, callEnv: () => ({ HOME: outside }) }));
    const ran = yield* answer(tools.bash, {
      command: `${JSON.stringify(rg)} -a -o 'function es\\(t\\).{0,18000}' ~/claude`,
      description: 'Read a minified function',
    });
    expect(ran.value).toBe(`${code}\n`);
    expect(ran.shown).toEqual([{ path: file, as: 'read' }]);
  }),
);

it.live('wrapped inline source returns its output without treating the program as a file', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const tools = createTools(options({ cwd: root }));
    const source = `const data = "${'x'.repeat(300)}"; console.log(data.length);`;
    const ran = yield* answer(tools.bash, {
      command: `exec env -u TAGMA_UNUSED bun -e '${source}'`,
      description: 'Evaluate inline source',
    });
    expect(ran.value).toBe('300\n');
    expect(ran.shown).toEqual([]);
  }),
);

it.live('an awk program and a shell body behind a launcher are code, never probed as files', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    yield* host.writeFile(join(root, 'rows.txt'), '1\n2\n');
    const tools = createTools(options({ cwd: root }));
    const program = `{n++; s+=$1; ${'x=1; '.repeat(60)}} END {printf "rows=%d sum=%d\\n", n, s}`;
    const awk = yield* answer(tools.bash, { command: `cat rows.txt | awk '${program}'`, description: 'Sum rows with awk' });
    expect(awk.value).toBe('rows=2 sum=3\n');
    expect(awk.shown).toEqual([{ path: join(root, 'rows.txt'), as: 'read' }]);
    const body = `status=0; for word in ${'alpha '.repeat(60)}; do : ; done; echo looped; exit $status`;
    const shell = yield* answer(tools.bash, { command: `nice /bin/sh -c '${body}'`, description: 'Loop in a shell body' });
    expect(shell.value).toBe('looped\n');
    expect(shell.shown).toEqual([]);
  }),
);

it.live('bash declares descriptions by policy and executes a call without one', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const tools = createTools(options({ cwd: root }));
    expect(tools.bash.inputSchema.required).toContain('description');
    const optional = createTools(options({ cwd: root, commandDescription: 'optional' }));
    expect(optional.bash.inputSchema.required).not.toContain('description');
    const input = yield* toolArguments(tools.bash, 'bash', { command: 'printf hello', waitMs: 1000 });
    const invalid = yield* Effect.flip(toolArguments(tools.bash, 'bash', { command: 'printf hello', description: 1 }));
    expect(invalid.code).toBe('body-shape');
    expect(toolDisplay(tools.bash, input)).toMatchObject({ title: 'printf hello', command: 'printf hello' });

    const ran = yield* answer(tools.bash, input);
    expect(ran.value).toBe('hello');
    expect(ran.display).toMatchObject({ form: 'command', title: 'printf hello', output: 'hello' });
  }),
);

it.live('a command carries what the catalog names, and not what it removes', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    process.env.RUNLITH_TOOLS_INHERITED = 'inherited';
    process.env.RUNLITH_TOOLS_STRIPPED = 'stripped';
    yield* Effect.gen(function* () {
      const tools = createTools(
        options({
          cwd: root,
          env: { RUNLITH_TOOLS_CARRIED: 'carried', RUNLITH_TOOLS_STRIPPED: undefined },
        }),
      );
      const said = yield* call(tools.bash, {
        command: 'echo "[$RUNLITH_TOOLS_CARRIED][$RUNLITH_TOOLS_STRIPPED][$RUNLITH_TOOLS_INHERITED]"',
        description: 'Print three variables',
      });
      expect(said).toContain('[carried][][inherited]');
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          delete process.env.RUNLITH_TOOLS_INHERITED;
          delete process.env.RUNLITH_TOOLS_STRIPPED;
        }),
      ),
    );
  }),
);

it.live("a command carries what its own call adds, and a later call's addition replaces it", () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const tools = createTools(
      options({
        cwd: root,
        env: { RUNLITH_TOOLS_ACT: 'standing' },
        callEnv: (called) => (called.step === undefined ? {} : { RUNLITH_TOOLS_ACT: `${called.toolCallId}:${called.step}` }),
      }),
    );
    const print = { command: 'echo "[$RUNLITH_TOOLS_ACT]"', description: 'Print the act' };
    expect(yield* call(tools.bash, print, { toolCallId: 'first', step: 2 })).toContain('[first:2]');
    expect(yield* call(tools.bash, print, { toolCallId: 'second', step: 3 })).toContain('[second:3]');
    expect(yield* call(tools.bash, print, { toolCallId: 'unnumbered', caller: unthreadedCaller })).toContain('[standing]');
  }),
);

it.live('bash retains only the bounded tail of oversized stdout and stderr', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const tools = createTools(options({ cwd: root }));
    const count = TOOL_OUTPUT_MAX_LINES + 500;
    const body = 'x'.repeat(80);
    const ran = yield* answer(tools.bash, {
      command: `i=0; while [ "$i" -lt ${count} ]; do printf 'line-%04d-${body}\\n' "$i"; i=$((i+1)); done; printf 'stderr-verdict\\n' >&2`,
      description: 'Print oversized output',
    });
    const value = String(ran.value);

    expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES);
    expect(value.split('\n').length).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_LINES);
    expect(value.endsWith('stderr-verdict\n')).toBe(true);
    if (ran.display?.form !== 'command') return yield* Effect.die(new Error('bash must answer a command'));
    expect(Buffer.byteLength(ran.display.output ?? '', 'utf8')).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES);
    expect((ran.display.output ?? '').split('\n').length).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_LINES);
  }),
);

it.live('interrupting a call takes the whole tree the command started down the ladder, a background job that ignores Ctrl-C included', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const grandchild = yield* connectedCommand(true);

    const tools = createTools(options({ cwd: root }));
    const execute = toolExecute(tools.bash);
    if (!execute) return yield* Effect.die(new Error('This world binds a filesystem and a spawner, so it has a shell.'));
    const running = yield* Effect.forkChild(
      execute(
        {
          command: `${grandchild.command} & wait`,
          description: 'Background a grandchild then wait',
        },
        { toolCallId: 'call-tree', caller: unthreadedCaller, messages: [] },
      ) as Effect.Effect<unknown, ToolFailed>,
    );
    yield* grandchild.connected;
    yield* Fiber.interrupt(running);
    const ended = yield* Fiber.await(running);
    yield* grandchild.disconnected;

    expect(Exit.isFailure(ended) && Cause.hasInterruptsOnly(ended.cause)).toBe(true);
  }),
);

it.live('a command that outlives its life is killed and told apart from a user abort', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const child = yield* connectedCommand();

    const spawned = yield* Deferred.make<ChildProcessHandle>();
    const exec = Layer.provide(
      Layer.effect(
        ChildProcessSpawner.ChildProcessSpawner,
        Effect.map(ChildProcessSpawner.ChildProcessSpawner, (inner) => ({
          ...inner,
          spawn: (command: Command) =>
            inner
              .spawn(command)
              .pipe(
                Effect.tap((handle) =>
                  command._tag === 'StandardCommand' && command.command === machineWorld.environment.shell
                    ? Deferred.succeed(spawned, handle)
                    : Effect.void,
                ),
              ),
        })),
      ),
      machineWorld.exec,
    );
    const tools = createTools(options({ cwd: root, world: { ...machineWorld, exec } }));
    const execute = toolExecute(tools.bash);
    if (!execute) return yield* Effect.die('the machine world has no shell');
    const result = yield* execute(
      { command: child.command, description: 'Outlast its life', lifeMs: 250 },
      { toolCallId: 'call-timeout', caller: unthreadedCaller, messages: [] },
    );
    const handle = yield* Deferred.await(spawned);
    yield* Effect.result(handle.exitCode);
    expect(yield* handle.isRunning).toBe(false);
    if (!(result instanceof ToolAnswer)) return yield* Effect.die('the shell returned no answer');
    expect(result.verdict).toEqual({ kind: 'failed', error: 'Command life ran out.' });
  }),
);

it.live("a spawner-road expiry answers the tool's own life, not the operator's ceiling", () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const tools = createTools(options({ cwd: root, world: { ...machineWorld, exec: managedExec(timeoutResult) } }));

    const result = yield* call(
      tools.bash,
      { command: 'printf hello', description: 'Print a word', lifeMs: 5000 },
      { toolCallId: 'call-spawner-timeout', caller: unthreadedCaller },
    );
    expect(result).toContain('life ran out (life 5s');
  }),
);

it.live('interrupting a local command finalizes it as aborted instead of leaking its window', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const child = yield* connectedCommand();
    const finished: FinishedCommand[] = [];
    const tools = createTools(
      options({
        cwd: root,
        world: { ...machineWorld, commands: { finished: (command: FinishedCommand) => Effect.sync(() => void finished.push(command)) } },
      }),
    );
    const execute = toolExecute(tools.bash);
    if (!execute) return yield* Effect.die(new Error('This world binds a filesystem and a spawner, so it has a shell.'));

    const waiter = yield* Effect.forkChild(
      execute(
        { command: child.command, description: 'Wait until interrupted' },
        { toolCallId: 'call-interrupted', caller: unthreadedCaller, messages: [] },
      ) as Effect.Effect<unknown, ToolFailed>,
    );
    yield* child.connected;
    yield* Fiber.interrupt(waiter);
    yield* child.disconnected;

    expect(finished).toHaveLength(1);
    expect(finished[0]?.exit).toEqual({
      _tag: 'Unknown',
      detail: 'the run was aborted and no exit was read: The command call was interrupted.',
    });
  }),
);

it.live('every tool answers the form its result really has, with the facts it measured', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    yield* host.writeFile(join(root, 'alpha.ts'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n', 'utf8');
    const tools = createTools(options({ cwd: root }));

    const read = yield* answer(tools.read, { path: 'alpha.ts' });
    expect(read.display?.form).toBe('code');
    if (read.display?.form !== 'code') return yield* Effect.die(new Error('read must answer code'));
    expect(read.display.language).toBe('ts');
    expect(read.display.path).toBe('alpha.ts');
    expect(read.display.text).toBe('const a = 1;\nconst b = 2;\nconst c = 3;\n'.trimEnd());

    const listing = yield* answer(tools.ls, {});
    expect(listing.display?.form).toBe('list');
    if (listing.display?.form !== 'list') return yield* Effect.die(new Error('ls must answer a list'));
    expect(listing.display.items.map((item) => item.label)).toEqual(['alpha.ts']);

    const matched = yield* answer(tools.glob, { pattern: '*.ts' });
    expect(matched.display?.form).toBe('list');

    const found = yield* answer(tools.grep, { pattern: 'const b', output_mode: 'content' });
    expect(found.display?.form).toBe('list');
    if (found.display?.form !== 'list') return yield* Effect.die(new Error('grep must answer a list'));
    expect(found.display.items[0]?.label).toBe('alpha.ts:2');
    expect(found.display.items[0]?.detail).toBe('const b = 2;');

    const created = yield* answer(tools.write, { path: 'beta.ts', content: 'export const b = 1;\n' });
    expect(created.display?.form).toBe('code');

    const replaced = yield* answer(tools.write, { path: 'beta.ts', content: 'export const b = 2;\n' });
    expect(replaced.display?.form).toBe('diff');
    if (replaced.display?.form !== 'diff') return yield* Effect.die(new Error('a replaced file must answer a patch'));
    expect([replaced.display.files[0].added, replaced.display.files[0].removed]).toEqual([1, 1]);

    const edited = yield* answer(tools.edit, {
      path: 'alpha.ts',
      oldString: 'const c = 3;',
      newString: 'const c = 4;',
    });
    expect(edited.display?.form).toBe('diff');
    if (edited.display?.form !== 'diff') return yield* Effect.die(new Error('edit must answer a patch'));
    expect(edited.display.files[0].patch).toContain('-const c = 3;');
    expect(edited.display.files[0].patch).toContain('+const c = 4;');

    const pending = toolDisplay(tools.bash, { command: 'printf hello', description: 'Print a word' });
    expect(pending).toMatchObject({ form: 'command', title: 'Print a word', command: 'printf hello' });

    const ran = yield* answer(tools.bash, { command: 'printf hello', description: 'Print a word' });
    expect(ran.display?.form).toBe('command');
    if (ran.display?.form !== 'command') return yield* Effect.die(new Error('bash must answer a command'));
    expect(ran.display.title).toBe('Print a word');
    expect(ran.display.command).toBe('printf hello');
    expect(ran.display.output).toBe('hello');
    expect(ran.display.facts).toBeUndefined();
    expect(ran.display.details?.[0]).toEqual({ label: 'exit', value: '0' });

    const failed = yield* answer(tools.bash, { command: 'exit 3', description: 'Fail on purpose' });
    expect(failed.display?.facts?.[0]).toEqual({ label: 'exit', value: '3' });
    expect(failed.display?.form).toBe('command');
  }),
);

it.live('a finished command is recorded once, by class and ending, with no command text in it', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const finished: FinishedCommand[] = [];
    const tools = createTools(
      options({
        cwd: root,
        world: { ...machineWorld, commands: { finished: (command: FinishedCommand) => Effect.sync(() => void finished.push(command)) } },
      }),
    );
    const shell = (command: string, description: string) => answer(tools.bash, { command, description });

    yield* shell('bun --version', 'Ask the runtime its version');
    expect(finished).toHaveLength(1);
    const only = finished[0] as FinishedCommand;
    expect(only.class).toBe('other');
    expect(only.exit).toEqual({ _tag: 'Code', code: 0 });
    expect(only.monotonicEnd).toBeGreaterThanOrEqual(only.monotonicStart);
    expect(only.cost._tag).toBe('Measured');
    if (only.cost._tag === 'Measured') {
      expect(only.cost.cpuMicros).toBeGreaterThan(0);
      expect(only.cost.peakRssBytes).toBeGreaterThan(0);
    }
    expect(JSON.stringify(only)).not.toContain('bun --version');

    yield* shell('exit 3', 'Fail on purpose');
    yield* shell('git --version', 'Ask git its version');
    expect(finished).toHaveLength(3);
    expect(finished[1]?.exit).toEqual({ _tag: 'Code', code: 3 });
    expect(finished[2]?.class).toBe('git');

    const plain = createTools(options({ cwd: root }));
    yield* answer(plain.bash, { command: 'printf hello', description: 'Print a word' });
    expect(finished).toHaveLength(3);
  }),
);

it.live('a body that is the answer or the effect declares itself, and a command that went wrong says so', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    yield* host.writeFile(join(root, 'alpha.ts'), 'const a = 1;\n', 'utf8');
    const tools = createTools(options({ cwd: root }));

    const read = yield* answer(tools.read, { path: 'alpha.ts' });
    expect(read.display?.opens).toBeUndefined();
    expect(toolDisplayOpensByDefault(read.display as ToolDisplay)).toBe(false);

    const created = yield* answer(tools.write, { path: 'beta.ts', content: 'export const b = 1;\n' });
    expect(created.display?.opens).toBe(true);
    expect(toolDisplayOpensByDefault(created.display as ToolDisplay)).toBe(true);

    const replaced = yield* answer(tools.write, { path: 'beta.ts', content: 'export const b = 2;\n' });
    expect(replaced.display?.opens).toBeUndefined();
    expect(toolDisplayOpensByDefault(replaced.display as ToolDisplay)).toBe(true);

    const ran = yield* answer(tools.bash, { command: 'printf hello', description: 'Print a word' });
    expect(ran.refusal).toBeUndefined();
    expect(toolDisplayOpensByDefault(ran.display as ToolDisplay)).toBe(false);

    const missed = yield* answer(tools.read, { path: 'nowhere.ts' });
    expect(missed.refusal?.code).toBe('not-found');

    const absent = [
      yield* answer(tools.grep, { pattern: 'a', path: 'nowhere' }),
      yield* answer(tools.glob, { pattern: '*.ts', path: 'nowhere' }),
      yield* answer(tools.ls, { path: 'nowhere' }),
      yield* answer(tools.edit, { path: 'nowhere.ts', oldString: 'a', newString: 'b' }),
      yield* answer(tools.rename, { from: 'nowhere.ts', to: 'elsewhere.ts' }),
    ];
    expect(absent.map((one) => one.refusal?.code)).toEqual(Array(absent.length).fill('not-found'));

    const unmatched = yield* answer(tools.edit, { path: 'alpha.ts', oldString: 'const z', newString: 'const y' });
    expect(unmatched.refusal?.code).toBe('no-match');

    const listedFile = yield* answer(tools.ls, { path: 'alpha.ts' });
    expect(listedFile.refusal?.code).toBe('wrong-kind');

    const badPattern = yield* answer(tools.grep, { pattern: '(' });
    expect(badPattern.refusal?.code).toBe('bad-pattern');
  }),
);

it.live('bash reports the files that moved, with the bytes now standing at each', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    yield* host.writeFile(join(dir, 'alpha.ts'), 'const a = 1;\n');
    yield* sh(dir, 'git add alpha.ts && git commit -qm first');
    const sink = recorder();
    const tools = createTools(options({ cwd: dir, changes: sink.port }));

    yield* call(tools.bash, {
      command: 'mkdir -p sub && cp alpha.ts sub/new.txt && cp alpha.ts beta.ts',
      description: 'Change two files',
    });

    expect(sink.moves.map((move) => move.name)).toEqual(['beta.ts', 'sub/new.txt']);
    const bytes = yield* host.readFile(join(dir, 'beta.ts'), 'utf8');
    expect(sink.moves.find((move) => move.name === 'beta.ts')?.after).toBe(contentDigest(bytes));
    expect(sink.moves[0]?.before).toBeNull();
  }),
);

it.live('bash reports rewrites of untracked files whose porcelain status stays unchanged', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    yield* host.writeFile(join(dir, 'template.ts'), 'export const formatted = 2;\n');
    yield* host.writeFile(join(dir, 'alpha.ts'), 'export const alpha=1;\n');
    yield* host.writeFile(join(dir, 'beta.ts'), 'export const beta=1;\n');
    const sink = recorder();
    const tools = createTools(options({ cwd: dir, changes: sink.port }));

    yield* call(tools.bash, {
      command: 'cp template.ts alpha.ts && cp template.ts beta.ts',
      description: 'Format two new files',
    });

    expect(sink.moves.map((move) => move.name)).toEqual(['alpha.ts', 'beta.ts']);
    for (const move of sink.moves) expect(move.after).toBe(contentDigest('export const formatted = 2;\n'));
  }),
);

it.live('bash reports rewrites of dirty tracked files whose porcelain status stays unchanged', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    yield* host.writeFile(join(dir, 'template.ts'), 'export const formatted = 3;\n');
    yield* host.writeFile(join(dir, 'alpha.ts'), 'export const alpha = 1;\n');
    yield* host.writeFile(join(dir, 'beta.ts'), 'export const beta = 1;\n');
    yield* sh(dir, 'git add template.ts alpha.ts beta.ts && git commit -qm first');
    yield* host.writeFile(join(dir, 'alpha.ts'), 'export const alpha = 2;\n');
    yield* host.writeFile(join(dir, 'beta.ts'), 'export const beta = 2;\n');
    const sink = recorder();
    const tools = createTools(options({ cwd: dir, changes: sink.port }));

    yield* call(tools.bash, {
      command: 'cp template.ts alpha.ts && cp template.ts beta.ts',
      description: 'Rewrite two dirty files',
    });

    expect(sink.moves.map((move) => move.name)).toEqual(['alpha.ts', 'beta.ts']);
    for (const move of sink.moves) expect(move.after).toBe(contentDigest('export const formatted = 3;\n'));
  }),
);

it.live('a command inside a nested repository measures the outer checkout not at all', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    yield* host.writeFile(join(dir, 'alpha.ts'), 'const a = 1;\n');
    yield* host.mkdir(join(dir, '.external', 'thing'), { recursive: true });
    yield* sh(join(dir, '.external', 'thing'), 'git init -q');
    yield* host.writeFile(join(dir, '.external', 'thing', 'alpha.ts'), 'const inner = 1;\n');
    yield* host.writeFile(join(dir, '.external', 'thing', 'template.ts'), 'const inner = 2;\n');
    const sink = recorder();
    const tools = createTools(options({ cwd: dir, changes: sink.port }));

    yield* call(tools.bash, {
      command: 'cp template.ts alpha.ts',
      workdir: '.external/thing',
      description: 'Rewrite a file of the nested clone',
    });

    expect(sink.moves).toEqual([]);
    expect(yield* host.readFile(join(dir, 'alpha.ts'), 'utf8')).toBe('const a = 1;\n');
  }),
);

it.live(
  'a path a command removed carries the hash of no text, dated no closer than from the command’s start to its directory’s change',
  () =>
    Effect.gen(function* () {
      const dir = yield* checkout();
      yield* host.writeFile(join(dir, 'alpha.ts'), 'const a = 1;\n');
      yield* sh(dir, 'git add alpha.ts && git commit -qm first');
      const sink = recorder();
      const tools = createTools(options({ cwd: dir, changes: sink.port }));

      yield* call(tools.bash, { command: 'rm -f alpha.ts', description: 'Remove one file' });

      expect(sink.moves).toHaveLength(1);
      expect(sink.moves[0]?.after).toBe(contentDigest(''));
      const written = sink.moves[0]?.written;
      expect(written?.to).toBe(Math.floor((yield* host.stat(dir)).mtimeMs));
      expect(written?.from).toBeLessThan(written?.to ?? 0);
    }),
);

it.live('a file a command moved into place is dated at the move, though the move kept its modification time', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    yield* host.writeFile(join(dir, 'alpha.ts'), 'const a = 1;\n');
    yield* sh(dir, 'git add alpha.ts && git commit -qm first');
    const sink = recorder();
    const tools = createTools(options({ cwd: dir, changes: sink.port }));

    yield* call(tools.bash, { command: 'git mv alpha.ts beta.ts', description: 'Move one file' });

    const info = yield* Effect.promise(() => lstat(join(dir, 'beta.ts'), { bigint: true }));
    const moved = Number(info.ctimeNs) / 1_000_000;
    expect(Number(info.mtimeNs) / 1_000_000).toBeLessThan(moved);
    expect(sink.moves.find((move) => move.name === 'beta.ts')?.written).toEqual({ from: moved, to: moved });
  }),
);

it.live('a command run outside any repository measures the session’s checkout it writes into', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    const scratch = yield* createTempDir();
    const sink = recorder();
    const tools = createTools(options({ cwd: dir, changes: sink.port, allowOutsideCwd: true }));

    yield* call(tools.bash, {
      command: `printf 'made\\n' > '${join(dir, 'made.ts')}'`,
      workdir: scratch,
      description: 'Write from scratch',
    });

    expect(sink.moves.map((move) => move.name)).toEqual(['made.ts']);
  }),
);

it.live('a command run in another repository measures the session’s checkout only when it names it', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    const foreign = yield* checkout();
    const sink = recorder();
    const tools = createTools(options({ cwd: dir, changes: sink.port, allowOutsideCwd: true }));

    yield* call(tools.bash, {
      command: `printf 'x\\n' > '../${basename(dir)}/unnamed.ts'`,
      workdir: foreign,
      description: 'Write unnamed',
    });
    yield* call(tools.bash, { command: `printf 'y\\n' > '${join(dir, 'named.ts')}'`, workdir: foreign, description: 'Write named' });

    expect(sink.moves.map((move) => move.name)).toEqual(['named.ts']);
  }),
);

it.live('an in-place sed of a named file is refused before it runs, and the file stands as it was', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    yield* host.writeFile(join(dir, 'alpha.ts'), 'const a = 1;\n');
    const tools = createTools(options({ cwd: dir }));

    const refused = yield* Effect.flip(preparationOf(tools.bash, { command: "sed -i '' 's/1/2/' alpha.ts", description: 'Edit' }));
    expect(refused).toBeInstanceOf(ToolFailed);
    yield* answer(tools.bash, { command: "sed -i '' 's/1/2/' alpha.ts", description: 'Edit' });
    expect(yield* host.readFile(join(dir, 'alpha.ts'), 'utf8')).toBe('const a = 1;\n');
  }),
);

it.live('a command answers the files it named and the files its output found', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    yield* host.mkdir(join(dir, 'src'));
    yield* host.writeFile(join(dir, 'src', 'alpha.ts'), 'const a = 1;\n');
    yield* host.writeFile(join(dir, 'src', 'beta.ts'), 'const b = 1;\n');
    const tools = createTools(options({ cwd: dir }));

    const read = yield* answer(tools.bash, { command: 'sed -n 1p src/alpha.ts', description: 'Read a file' });
    expect(read.shown).toEqual([{ path: join(dir, 'src', 'alpha.ts'), as: 'read' }]);
    const found = yield* answer(tools.bash, { command: 'cd src && grep -n const beta.ts alpha.ts /dev/null', description: 'Search' });
    expect(found.shown.map((one) => one.path).sort()).toEqual([join(dir, 'src', 'alpha.ts'), join(dir, 'src', 'beta.ts')]);
  }),
);

it.live('a command that only reads reports nothing', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    yield* host.writeFile(join(dir, 'alpha.ts'), 'const a = 1;\n');
    const sink = recorder();
    const tools = createTools(options({ cwd: dir, changes: sink.port }));

    const read = yield* call(tools.bash, { command: 'cat alpha.ts', description: 'Read a file' });
    expect(read).toContain('const a = 1;');
    expect(sink.moves).toHaveLength(0);
  }),
);

it.live('a second command reports only its own changes, measuring one side', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    yield* host.writeFile(join(dir, 'alpha.ts'), 'const a = 1;\n');
    yield* sh(dir, 'git add alpha.ts && git commit -qm first');
    const sink = recorder();
    const tools = createTools(options({ cwd: dir, changes: sink.port }));

    yield* call(tools.bash, { command: 'cp alpha.ts one.txt', description: 'Copy once' });

    const second = yield* call(tools.bash, { command: 'cp alpha.ts two.txt', description: 'Copy again' });
    expect(second).not.toContain('one.txt');

    expect(sink.moves.map((move) => move.name)).toEqual(['one.txt', 'two.txt']);
  }),
);

it.live('a failed measurement drops its baseline instead of lending it to the next command', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    yield* host.writeFile(join(dir, 'template.ts'), 'const a = 1;\n');
    const sink = recorder();
    const tools = createTools(options({ cwd: dir, changes: sink.port }));

    yield* call(tools.bash, { command: 'cp template.ts first.ts', description: 'Write one file' });
    expect(sink.moves.map((move) => move.name)).toEqual(['first.ts']);

    yield* host.writeFile(join(dir, '.git', 'index'), 'not an index');
    yield* call(tools.bash, { command: 'cp template.ts during.ts', description: 'Write while unreadable' });
    yield* sh(dir, 'rm -f .git/index && git add -A');

    yield* call(tools.bash, { command: 'cp template.ts after.ts', description: 'Write once readable again' });

    const claimed = sink.moves.map((move) => move.name);
    expect(claimed).toContain('after.ts');
    expect(claimed).not.toContain('during.ts');
  }),
);

it.live('a refused toplevel is retried, so one blip does not silence the turn', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    yield* host.writeFile(join(dir, 'template.ts'), 'const a = 1;\n');
    const config = yield* host.readFile(join(dir, '.git', 'config'), 'utf8');
    const sink = recorder();
    const tools = createTools(options({ cwd: dir, changes: sink.port }));

    yield* host.writeFile(join(dir, '.git', 'config'), '[core]\n\trepositoryformatversion = 99\n');
    const refused = yield* call(tools.bash, {
      command: 'cp template.ts during.ts',
      description: 'Write while git refuses',
    });
    expect(refused).toContain('the checkout was NOT measured');

    yield* host.writeFile(join(dir, '.git', 'config'), config);
    yield* call(tools.bash, {
      command: 'cp template.ts after.ts',
      description: 'Write once git answers again',
    });

    expect(sink.moves.map((move) => move.name)).toEqual(['after.ts']);
  }),
);

it.live('a sweep git cannot place is put to the reader rather than refused', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    yield* host.writeFile(join(dir, 'tracked.ts'), 'export const value = 1;\n');
    yield* sh(dir, 'git add tracked.ts && git commit -qm first');
    yield* host.writeFile(join(dir, 'loose.ts'), 'export const loose = true;\n');
    const config = yield* host.readFile(join(dir, '.git', 'config'), 'utf8');
    const sink = recorder();
    const tools = createTools(options({ cwd: dir, changes: sink.port, checkout: () => Effect.succeed('shared') }));

    yield* host.writeFile(join(dir, '.git', 'config'), '[core]\n\trepositoryformatversion = 99\n');

    const asked = yield* preparationOf(tools.bash, { command: 'git add -A', description: 'Stage everything' });
    expect((asked?.raised ?? []).length).toBeGreaterThan(0);

    yield* host.writeFile(join(dir, '.git', 'config'), config);
    expect(yield* shText(dir, 'git diff --cached --name-only')).toBe('');
    expect(yield* shText(dir, 'git status --porcelain')).toContain('?? loose.ts');
    expect(sink.moves).toHaveLength(0);
  }),
);

it.live('a file over the kept-bytes cap is digested from its streamed bytes', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    const sink = recorder();
    const tools = createTools(options({ cwd: dir, changes: sink.port }));

    const source = join(dir, 'source.bin');
    yield* host.writeFile(source, '');
    yield* host.truncate(source, 16 * 1024 * 1024 + 1);

    yield* call(tools.bash, { command: 'cp source.bin over.bin', description: 'Copy one oversized file' });

    const overRow = sink.moves.find((move) => move.name === 'over.bin');
    expect(overRow?.after).toBe(bytesDigest(yield* Effect.promise(() => Bun.file(source).bytes())));
    expect(overRow?.bytes).toBeNull();
  }),
);

it.live('the first command of a catalog measures both sides and ignores what it inherited', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    yield* host.writeFile(join(dir, 'alpha.ts'), 'const a = 1;\n');
    const sink = recorder();
    const tools = createTools(options({ cwd: dir, changes: sink.port }));

    yield* call(tools.bash, { command: 'cp alpha.ts copied.txt', description: 'Copy one file' });
    expect(sink.moves).toHaveLength(1);
  }),
);

const consentIds = (prepared: { readonly raised?: readonly Raised[] } | null | undefined) =>
  (prepared?.raised ?? []).map((one) => one.condition);

it.live(
  'a shared-checkout sweep is a consent the door puts to the reader, a single checkout declares none, and the sweep runs as typed once allowed',
  () =>
    Effect.gen(function* () {
      const dir = yield* checkout();
      yield* host.writeFile(join(dir, 'tracked.ts'), 'export const value = 1;\n');
      yield* sh(dir, 'git add tracked.ts && git commit -qm first');

      let kind: 'shared' | 'single' = 'shared';
      const tools = createTools(options({ cwd: dir, changes: recorder().port, checkout: () => Effect.succeed(kind) }));

      yield* host.writeFile(join(dir, 'tracked.ts'), 'export const value = 2;\n');
      const asked = yield* preparationOf(tools.bash, { command: 'git stash push', description: 'Stash the tree' });
      expect((asked?.raised ?? []).length).toBeGreaterThan(0);
      expect(consentIds(asked)).toEqual(['shared-checkout-sweep']);

      yield* call(tools.bash, { command: 'git stash push', description: 'Stash the tree' });
      expect(yield* host.readFile(join(dir, 'tracked.ts'), 'utf8')).toBe('export const value = 1;\n');
      expect(yield* shText(dir, 'git stash list')).toContain('stash@{0}');

      kind = 'single';
      const alone = yield* preparationOf(tools.bash, { command: 'git stash push', description: 'Stash the tree' });
      expect(consentIds(alone)).toEqual([]);
    }),
);

it.live('a bare git commit in a shared checkout asks for the operator’s word instead of refusing, and commits once allowed', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    yield* host.writeFile(join(dir, 'tracked.ts'), 'export const value = 1;\n');
    yield* sh(dir, 'git add tracked.ts && git commit -qm first');
    yield* host.writeFile(join(dir, 'tracked.ts'), 'export const value = 2;\n');
    yield* sh(dir, 'git add tracked.ts');
    const head = Effect.map(shText(dir, 'git rev-parse HEAD'), (text) => text.trim());
    const first = yield* head;

    const tools = createTools(options({ cwd: dir, changes: recorder().port, checkout: () => Effect.succeed('shared') }));
    for (const command of ['git commit -m second', `git -C ${dir} commit -m second`, 'git add -A && git commit -m second']) {
      expect(consentIds(yield* preparationOf(tools.bash, { command, description: 'Commit the index' }))).toEqual(['shared-checkout-sweep']);
    }
    expect(yield* head).toBe(first);

    yield* call(tools.bash, { command: 'git commit -m second', description: 'Commit the index' });
    expect(yield* head).not.toBe(first);
  }),
);

it.live('a commit into another registered checkout is a consent; into this one or an unregistered repository it declares none', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    const other = yield* checkout();
    const scratch = yield* checkout();
    const registered = new Set([yield* host.realpath(other)]);

    const tools = createTools(
      options({
        cwd: dir,
        changes: recorder().port,
        checkout: () => Effect.succeed('shared'),
        checkoutAt: (tree) => Effect.succeed(registered.has(tree)),
      }),
    );
    const asked = yield* preparationOf(tools.bash, {
      command: `cd ${other} && git commit -m change -- a.ts`,
      description: 'Commit elsewhere',
    });
    expect((asked?.raised ?? []).length).toBeGreaterThan(0);
    expect(consentIds(asked)).toEqual(['commit-elsewhere']);
    const own = yield* preparationOf(tools.bash, { command: 'git commit -m change -- a.ts', description: 'Commit here' });
    expect(consentIds(own)).toEqual([]);
    const unregistered = yield* preparationOf(tools.bash, {
      command: `cd ${scratch} && git add -A && git commit -qm snapshot`,
      description: 'Commit a scratch repository',
    });
    expect(consentIds(unregistered)).toEqual([]);
  }),
);

it.live('both finishing forms classify a resolved merge in another registered worktree as committing elsewhere', () =>
  Effect.gen(function* () {
    const dir = yield* checkout({ 'shared.ts': 'export const value = 1;\n' });
    const other = yield* createTempDir();
    yield* sh(dir, `git worktree add -q -b other ${JSON.stringify(other)}`);
    yield* host.writeFile(join(other, 'shared.ts'), 'export const value = 2;\n');
    yield* sh(other, 'git commit -qam theirs');
    yield* host.writeFile(join(dir, 'shared.ts'), 'export const value = 3;\n');
    yield* sh(dir, 'git commit -qam ours');
    yield* sh(other, 'git merge main', true);
    yield* host.writeFile(join(other, 'shared.ts'), 'export const value = 4;\n');
    yield* sh(other, 'git add shared.ts');

    const own = createTools(options({ cwd: other, changes: recorder().port, checkout: () => Effect.succeed('shared') }));
    expect(consentIds(yield* preparationOf(own.bash, { command: 'git commit --no-edit', description: 'Commit the merge' }))).toEqual([
      'shared-checkout-sweep',
    ]);
    expect(consentIds(yield* preparationOf(own.bash, { command: 'git merge --continue', description: 'Conclude the merge' }))).toEqual([]);
    const registered = yield* host.realpath(other);
    const tools = createTools(
      options({
        cwd: dir,
        allowOutsideCwd: true,
        changes: recorder().port,
        checkoutAt: (tree) => Effect.succeed(tree === registered),
      }),
    );
    const continued = { command: 'GIT_EDITOR=true git merge --continue', workdir: other, description: 'Conclude the merge' };
    expect(
      consentIds(yield* preparationOf(tools.bash, { command: 'git commit --no-edit', workdir: other, description: 'Commit the merge' })),
    ).toEqual(['commit-elsewhere']);
    expect(consentIds(yield* preparationOf(tools.bash, continued))).toEqual(['commit-elsewhere']);
    expect((yield* sh(other, 'git rev-parse -q --verify MERGE_HEAD', true)).exitCode).toBe(0);

    yield* call(tools.bash, continued);

    const parents = (yield* shText(other, 'git rev-list --parents -n 1 HEAD')).trim().split(' ');
    expect(parents).toHaveLength(3);
    expect((yield* sh(other, 'git rev-parse -q --verify MERGE_HEAD', true)).exitCode).not.toBe(0);
  }),
);

it.live('bash lets a nested repository run a classified git sweep', () =>
  Effect.gen(function* () {
    const dir = yield* checkout();
    const nested = join(dir, 'nested');
    yield* host.mkdir(nested);
    yield* sh(nested, `git init -q && ${GIT_USER}`);
    yield* host.writeFile(join(nested, 'tracked.ts'), 'export const value = 1;\n');
    yield* sh(nested, 'git add tracked.ts && git commit -qm first');
    yield* host.writeFile(join(nested, 'tracked.ts'), 'export const value = 2;\n');

    const tools = createTools(options({ cwd: dir, changes: recorder().port, checkout: () => Effect.succeed('shared') }));
    yield* call(tools.bash, { command: 'git stash push', workdir: 'nested', description: 'Stash in the nested repository' });

    expect(yield* host.readFile(join(nested, 'tracked.ts'), 'utf8')).toBe('export const value = 1;\n');
    expect((yield* shText(nested, 'git stash list')).trim().length).toBeGreaterThan(0);
  }),
);
