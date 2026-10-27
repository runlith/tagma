import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect } from 'effect';
import type { TerminalInput } from '@runlith/executions/TerminalInput';
import { BindingId, Principal } from '@runlith/executions/protocol/custody';
import { ExecutionId, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InputAnswer, InputRequest } from '@runlith/executions/protocol/input';
import { ViewId, type TerminalBox, type TerminalDecider } from '../contract/wire/viewLeases.js';
import { makeExecutionGrids } from './gridControl.js';

const execution: ExecutionRef = { installation: InstallationId.make('grids'), execution: ExecutionId.make('exec-1'), incarnation: 0 };

const admitted = (request: InputRequest): InputAnswer =>
  ({ _tag: 'InputAdmitted', receipt: { sequence: request.sequence } }) as unknown as InputAnswer;

it.live('an agent resize admitted while the server’s own resize is in flight is the grid that stands, on the pty and in every view', () =>
  Effect.gen(function* () {
    const sent: TerminalBox[] = [];
    const heard: TerminalDecider[] = [];
    const first = yield* Deferred.make<void>();
    const executions = {
      openBinding: () => Effect.succeed({ _tag: 'Bound', binding: BindingId.make('grid-lane') }),
      closeBinding: () => Effect.succeed({ _tag: 'Unbound' }),
      input: Effect.fnUntraced(function* (_execution: ExecutionRef, _scope: unknown, request: InputRequest) {
        if (request.act._tag === 'Resize') sent.push(request.act.geometry);
        if (sent.length === 1) yield* Deferred.await(first);
        return admitted(request);
      }),
    } as unknown as TerminalInput['Service'];
    const grids = yield* makeExecutionGrids({ executions, viewOf: () => undefined });
    const view = { rows: 30, columns: 100 };
    const agent = { rows: 40, columns: 120 };

    yield* grids.watch(execution, ViewId.make('view'), 1, view, (applied) => heard.push(applied));
    while (sent.length === 0) yield* Effect.yieldNow;
    yield* grids.admitted(
      execution,
      { binding: BindingId.make('agent'), principal: Principal.make('thread:agent') },
      { act: { _tag: 'Resize', geometry: agent }, cause: 'resize' },
      admitted({ sequence: 0 } as InputRequest),
    );
    yield* Deferred.succeed(first, undefined);
    while (sent.length < 2) yield* Effect.sleep(1);
    yield* Effect.sleep(5);

    expect(sent).toEqual([view, agent]);
    expect(heard.at(-1)).toEqual({ decider: null, applied: agent });
    expect(grids.standing(execution)?.applied).toEqual(agent);
  }),
);

it.live(
  'an operator act that lands while the agent’s box is being restored makes its view decide, and the pty ends at that view’s box',
  () =>
    Effect.gen(function* () {
      const sent: TerminalBox[] = [];
      const heard: TerminalDecider[] = [];
      const gates = [yield* Deferred.make<void>(), yield* Deferred.make<void>()];
      const executions = {
        openBinding: () => Effect.succeed({ _tag: 'Bound', binding: BindingId.make('grid-lane') }),
        closeBinding: () => Effect.succeed({ _tag: 'Unbound' }),
        input: Effect.fnUntraced(function* (_execution: ExecutionRef, _scope: unknown, request: InputRequest) {
          if (request.act._tag === 'Resize') sent.push(request.act.geometry);
          const gate = gates[sent.length - 1];
          if (gate !== undefined) yield* Deferred.await(gate);
          return admitted(request);
        }),
      } as unknown as TerminalInput['Service'];
      const views = new Map([
        [BindingId.make('lane-a'), ViewId.make('a')],
        [BindingId.make('lane-c'), ViewId.make('c')],
      ]);
      const grids = yield* makeExecutionGrids({ executions, viewOf: (binding) => views.get(binding) });
      const boxA = { rows: 30, columns: 100 };
      const boxC = { rows: 50, columns: 160 };
      const agent = { rows: 40, columns: 120 };
      const typedBy = (binding: string) =>
        grids.admitted(
          execution,
          { binding: BindingId.make(binding), principal: Principal.make('operator') },
          { act: { _tag: 'Write', bytes: new Uint8Array([97]) }, cause: 'typed' },
          admitted({ sequence: 0 } as InputRequest),
        );

      yield* grids.watch(execution, ViewId.make('a'), 1, boxA, (applied) => heard.push(applied));
      yield* grids.watch(execution, ViewId.make('c'), 1, boxC, () => undefined);
      yield* typedBy('lane-a');
      while (sent.length < 1) yield* Effect.yieldNow;
      yield* grids.admitted(
        execution,
        { binding: BindingId.make('agent'), principal: Principal.make('thread:agent') },
        { act: { _tag: 'Resize', geometry: agent }, cause: 'resize' },
        admitted({ sequence: 0 } as InputRequest),
      );
      yield* Deferred.succeed(gates[0]!, undefined);
      while (sent.length < 2) yield* Effect.sleep(1);
      yield* typedBy('lane-c');
      yield* Deferred.succeed(gates[1]!, undefined);
      while (sent.length < 3) yield* Effect.sleep(1);
      yield* Effect.sleep(5);

      expect(sent).toEqual([boxA, agent, boxC]);
      expect(heard.at(-1)).toEqual({ decider: ViewId.make('c'), applied: boxC });
      expect(grids.standing(execution)?.applied).toEqual(boxC);
    }),
);

it.live('an agent resize made while no view watched does not keep the first view that comes from sizing the pty to its box', () =>
  Effect.gen(function* () {
    const sent: TerminalBox[] = [];
    const executions = {
      openBinding: () => Effect.succeed({ _tag: 'Bound', binding: BindingId.make('grid-lane') }),
      closeBinding: () => Effect.succeed({ _tag: 'Unbound' }),
      input: (_execution: ExecutionRef, _scope: unknown, request: InputRequest) => {
        if (request.act._tag === 'Resize') sent.push(request.act.geometry);
        return Effect.succeed(admitted(request));
      },
    } as unknown as TerminalInput['Service'];
    const grids = yield* makeExecutionGrids({ executions, viewOf: () => undefined });
    const view = { rows: 30, columns: 100 };

    yield* grids.admitted(
      execution,
      { binding: BindingId.make('agent'), principal: Principal.make('thread:agent') },
      { act: { _tag: 'Resize', geometry: { rows: 40, columns: 120 } }, cause: 'resize' },
      admitted({ sequence: 0 } as InputRequest),
    );
    yield* grids.watch(execution, ViewId.make('view'), 1, view, () => undefined);
    while (sent.length < 1) yield* Effect.sleep(1);

    expect(sent).toEqual([view]);
    expect(grids.standing(execution)?.applied).toEqual(view);
  }),
);

it.live('bytes the engine composed through a view’s lane — a focus report, a hover — make no decider; typing does', () =>
  Effect.gen(function* () {
    const sent: TerminalBox[] = [];
    const executions = {
      openBinding: () => Effect.succeed({ _tag: 'Bound', binding: BindingId.make('grid-lane') }),
      closeBinding: () => Effect.succeed({ _tag: 'Unbound' }),
      input: (_execution: ExecutionRef, _scope: unknown, request: InputRequest) => {
        if (request.act._tag === 'Resize') sent.push(request.act.geometry);
        return Effect.succeed(admitted(request));
      },
    } as unknown as TerminalInput['Service'];
    const views = new Map([
      [BindingId.make('lane-a'), ViewId.make('a')],
      [BindingId.make('lane-b'), ViewId.make('b')],
    ]);
    const grids = yield* makeExecutionGrids({ executions, viewOf: (binding) => views.get(binding) });
    const boxA = { rows: 30, columns: 100 };
    const boxB = { rows: 50, columns: 160 };
    const through = (binding: string, cause: 'raw' | 'typed') =>
      grids.admitted(
        execution,
        { binding: BindingId.make(binding), principal: Principal.make('operator') },
        { act: { _tag: 'Write', bytes: new TextEncoder().encode('\u001b[I') }, cause },
        admitted({ sequence: 0 } as InputRequest),
      );

    yield* grids.watch(execution, ViewId.make('a'), 1, boxA, () => undefined);
    yield* grids.watch(execution, ViewId.make('b'), 2, boxB, () => undefined);
    yield* through('lane-a', 'typed');
    while (sent.length < 1) yield* Effect.sleep(1);
    yield* through('lane-b', 'raw');
    yield* Effect.sleep(5);

    expect(sent).toEqual([boxA]);
    expect(grids.standing(execution)?.decider).toEqual(ViewId.make('a'));
  }),
);

it.live('the grid lane is closed through the close it was given, so a lost close is the retrying owner’s to ask again', () =>
  Effect.gen(function* () {
    const closed: string[] = [];
    const executions = {
      openBinding: () => Effect.succeed({ _tag: 'Bound', binding: BindingId.make('grid-lane') }),
      closeBinding: () => Effect.die(new Error('the grid closes only through the close it was given')),
      input: (_execution: ExecutionRef, _scope: unknown, request: InputRequest) => Effect.succeed(admitted(request)),
    } as unknown as TerminalInput['Service'];
    const grids = yield* makeExecutionGrids({
      executions,
      viewOf: () => undefined,
      close: (binding) =>
        Effect.sync(() => {
          closed.push(binding);
        }),
    });

    yield* grids.watch(execution, ViewId.make('view'), 1, { rows: 30, columns: 100 }, () => undefined);
    while (!grids.holdsLane(execution)) yield* Effect.sleep(1);
    yield* grids.ended(execution);

    expect(closed).toEqual(['grid-lane']);
  }),
);

it.live('a decider’s box the host will not take is told to every view as the grid that stands, with no decider', () =>
  Effect.gen(function* () {
    const heard: TerminalDecider[] = [];
    const executions = {
      openBinding: () => Effect.succeed({ _tag: 'Bound', binding: BindingId.make('grid-lane') }),
      closeBinding: () => Effect.succeed({ _tag: 'Unbound' }),
      input: (_execution: ExecutionRef, _scope: unknown, request: InputRequest) =>
        Effect.succeed(
          request.act._tag === 'Resize' && request.act.geometry.columns > 200
            ? ({
                _tag: 'InputUnsupported',
                act: 'resize',
                reason: 'geometry',
                detail: 'past the reserved screen',
              } as unknown as InputAnswer)
            : admitted(request),
        ),
    } as unknown as TerminalInput['Service'];
    const grids = yield* makeExecutionGrids({ executions, viewOf: () => undefined });
    const small = { rows: 30, columns: 100 };
    const huge = { rows: 60, columns: 320 };

    yield* grids.watch(execution, ViewId.make('view'), 1, small, (applied) => heard.push(applied));
    while (heard.length < 1) yield* Effect.sleep(1);
    yield* grids.report(execution, ViewId.make('view'), 1, huge);
    while (heard.length < 2) yield* Effect.sleep(1);

    expect(heard).toEqual([
      { decider: ViewId.make('view'), applied: small },
      { decider: null, applied: small },
    ]);
    expect(grids.standing(execution)?.applied).toEqual(small);
  }),
);
