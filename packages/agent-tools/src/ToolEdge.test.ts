import { unthreadedCaller } from './testing/caller';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { Tool, ToolFailed } from '@runlith/agent/tool';
import { SpawnAnnotation, type CallAnnotation, type SpawnObservation } from '@runlith/executions/executionSpawner';
import { ExecutionId, InstallationId, HostRequestKey } from '@runlith/executions/protocol/execution';
import { runToolEffect, WorkspaceRefused } from './ToolEdge';

it.effect('a typed refusal leaves through the error channel with its sentence', () =>
  Effect.gen(function* () {
    const failure = yield* runToolEffect('read', Layer.empty, new WorkspaceRefused({ attempted: '/etc/hosts', root: '/work' })).pipe(
      Effect.flip,
    );

    expect(failure).toBeInstanceOf(ToolFailed);
    expect(failure.reason).toBe('[read] error: Path escapes workspace root: /etc/hosts (root: /work)');
  }),
);

it.effect('a defect becomes the same failure and never escapes as a defect', () =>
  Effect.gen(function* () {
    const failure = yield* runToolEffect('boom-tool', Layer.empty, Effect.die(new Error('boom'))).pipe(Effect.flip);

    expect(failure).toBeInstanceOf(ToolFailed);
    expect(failure.reason).toBe('[boom-tool] error: boom');
  }),
);

const execution: SpawnObservation['execution'] = {
  installation: InstallationId.make('installation'),
  execution: ExecutionId.make('execution-1'),
  incarnation: 1,
};
const operation: SpawnObservation['operation'] = {
  installation: execution.installation,
  operation: HostRequestKey.make('call-7:1'),
};
const command: SpawnObservation['command'] = { program: 'rg', args: ['--files', '--glob', '*.ts'], environment: [] };

it.effect('a body runs under its own call, and what that call starts is linked to it', () =>
  Effect.gen(function* () {
    let seen: CallAnnotation | undefined;
    const linked: Array<unknown> = [];
    let released = 0;
    const progress: NonNullable<Tool.ToolCallDispatchOptions['progress']> = {
      link: (entry) => {
        linked.push(entry);
        return () => {
          released += 1;
        };
      },
      stage: () => {},
      watch: () => {},
      handOff: () => Effect.succeed({ status: 'unavailable', detail: null }),
      stopped: () => null,
      stopping: Effect.never,
    };
    const body = Effect.gen(function* () {
      seen = yield* SpawnAnnotation;
      seen?.observed?.({ execution, operation, command });
      return 'listed';
    });

    const answer = yield* runToolEffect('glob', Layer.empty, body, {
      toolCallId: 'call-7',
      caller: unthreadedCaller,
      messages: [],
      progress,
    }).pipe(Effect.provideService(SpawnAnnotation, { purpose: 'internal' }));

    expect(answer).toBe('listed');
    expect(seen?.purpose).toBe('internal');
    expect(seen?.correlation).toBe('call-7');
    expect(seen?.stop).toBe(progress);
    expect(linked).toEqual([{ execution, operation, kind: 'support', label: 'rg --files --glob *.ts' }]);
    expect(released).toBe(1);
  }),
);
