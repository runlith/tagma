import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, FileSystem, Fiber, Scope } from 'effect';
import type { Outlet } from '@runlith/acp/agent';
import { hostedAgent } from '@runlith/hosted-runner/agent';
import type { HostedDoor } from '@runlith/hosted-runner/door';
import { MuseRefused, MuseSdk, type Frame } from './channel.js';
import { makeMuseCycle } from './cycle.js';

const TURN = '01a19573-1cea-7c2e-90b4-2854e4328409';

type Sent = { readonly method: string; readonly params: Record<string, unknown>; readonly id?: string };

type Script = (
  sent: Sent,
  emit: (frame: Omit<Frame, 'request'> & { request?: boolean }) => Effect.Effect<void>,
) => Effect.Effect<Record<string, unknown>, MuseRefused>;

const world = Effect.fnUntraced(function* (script: Script, prompt: () => string = () => 'the frozen prompt') {
  const scope = yield* Effect.scope;
  const sent: Sent[] = [];
  const launches: Parameters<MuseSdk['Service']['open']>[0][] = [];
  const settings: string[] = [];
  const seen: { readonly kind: string; readonly body: unknown }[] = [];
  let minted = 0;
  const catalog = { description: 'echo' };
  const sdk = MuseSdk.of({
    open: (launch) =>
      Effect.sync(() => {
        launches.push(launch);
        const emit = (frame: Omit<Frame, 'request'> & { request?: boolean }) => launch.frame({ request: false, ...frame });
        return {
          home: '/home/.local/share/muse',
          command: (method, params, id) => {
            const one = { method, params, id };
            sent.push(one);
            return script(one, emit);
          },
          request: (method, params) => {
            sent.push({ method, params });
            return method === 'model/list'
              ? Effect.succeed({
                  providerId: 'meta',
                  models: [
                    {
                      modelId: 'muse-spark-1.2',
                      displayLabel: 'Spark',
                      providerId: 'meta',
                      isDefault: true,
                      contextLimit: 1_000_000,
                      outputLimit: 128_000,
                    },
                  ],
                })
              : script({ method, params }, emit);
          },
          mint: () => `00000000-0000-7000-8000-${String(++minted).padStart(12, '0')}`,
          ended: Effect.never,
        };
      }),
  });
  const door: HostedDoor = {
    agent: () => Effect.sync(() => ({ prompt: prompt(), web: 'none' as const })),
    turn: () => Effect.sync(() => ({ prompt: prompt(), context: 'turn context', web: 'none' as const })),
    tools: () =>
      Effect.sync(() => ({
        names: ['echo'],
        tools: [{ name: 'echo', description: catalog.description, inputSchema: {}, mutates: false }],
      })),
    history: () => Effect.succeed([]),
    call: () => Effect.succeed({ status: 'called', content: [{ type: 'text', text: 'echoed' }], failed: false, offered: false, words: [] }),
  };
  const outlet: Outlet = {
    update: (update) => Effect.sync(() => void seen.push({ kind: 'update', body: update })),
    notify: (method, params) => Effect.sync(() => void seen.push({ kind: method, body: params })),
    request: (method, params) =>
      Effect.sync(() => {
        seen.push({ kind: method, body: params });
        return { outcome: { outcome: 'selected', optionId: 'allow' } };
      }),
  };
  const files = FileSystem.makeNoop({
    writeFileString: (_path, text) => Effect.sync(() => void settings.push(text)),
    rename: () => Effect.void,
  });
  const cycle = yield* makeMuseCycle(
    door,
    { stderr: () => {}, died: (reason) => Effect.die(reason) },
    {
      place: { account: '/data/muse-code', config: '/thread/config' },
      env: {},
      program: 'muse',
      mint: () => `00000000-0000-7000-8000-${String(++minted).padStart(12, '0')}`,
      serve: () => Effect.succeed({ url: 'http://127.0.0.1:1/mcp' }),
    },
    { model: 'muse-spark-1.2', effort: 'minimal', parameters: {}, version: 'test' },
  ).pipe(Effect.provideService(MuseSdk, sdk), Effect.provideService(FileSystem.FileSystem, files), Scope.provide(scope));
  const agent = hostedAgent(cycle, door)(outlet);
  return { agent, sent, launches, settings, seen, catalog };
});

const ok = (sent: Sent, extra: Record<string, unknown> = {}) => Effect.succeed({ commandId: sent.id ?? 'c', status: 'accepted', ...extra });

it.effect('a turn runs under the Tagma turn id, seals each Tagma call before approving it, and measures every completion', () =>
  Effect.gen(function* () {
    const { agent, sent, settings, seen } = yield* world((one, emit) => {
      if (one.method === 'session/start') return ok(one, { session: { sessionId: one.params.sessionId } });
      if (one.method === 'turn/start')
        return Effect.as(
          Effect.forkDetach(
            Effect.gen(function* () {
              yield* emit({ method: 'turn/started', params: { sessionId: one.params.sessionId, turnId: TURN } });
              const usage = {
                inputTokens: 100,
                outputTokens: 10,
                cachedTokens: 80,
                cacheReadTokens: 80,
                cacheWriteTokens: 0,
                reasoningTokens: 2,
              };
              yield* emit({
                method: 'session/tokenUsage',
                params: { sessionId: one.params.sessionId, turnId: TURN, modelId: 'muse-spark-1.2', usage, promptTokens: 100 },
              });
              yield* emit({
                method: 'approval/request',
                request: true,
                params: {
                  sessionId: one.params.sessionId,
                  approvalId: 'a1',
                  turnId: TURN,
                  toolCallId: 'call_1',
                  toolName: 'mcp__tagma__echo',
                  rawArgs: '{"text":"hi"}',
                  currentRequirementId: { approvalId: 'a1', sourceIndex: 0 },
                  availableChoices: [
                    { choiceId: 'allow_once', decision: 'approved', scope: 'once' },
                    { choiceId: 'abort', decision: 'abort', scope: 'once' },
                  ],
                  subject: { kind: 'tool', toolName: 'mcp__tagma__echo' },
                },
              });
              yield* emit({ method: 'turn/completed', params: { sessionId: one.params.sessionId, turnId: TURN, terminal: 'completed' } });
            }),
          ),
          { commandId: one.id, status: 'accepted', turnId: TURN, disposition: 'started' },
        );
      return ok(one);
    });
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    const answer = yield* agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'go' }],
      _meta: { 'tagma/turn': TURN },
    });
    expect(answer).toMatchObject({ stopReason: 'end_turn', _meta: { 'tagma/turn': { prompt: TURN } } });
    const started = sent.find((one) => one.method === 'session/start')!;
    expect(started.params).toMatchObject({ approvalMode: 'promptUnmatched', permissionProfile: ':ask-me', modelId: 'muse-spark-1.2' });
    expect(sent.find((one) => one.method === 'turn/start')).toMatchObject({
      id: TURN,
      params: {
        reasoningEffort: 'minimal',
        input: [
          { type: 'text', text: 'turn context' },
          { type: 'text', text: 'go' },
        ],
      },
    });
    expect(JSON.parse(settings.at(-1)!).run).toMatchObject({
      toolset: ['mcp__tagma__*'],
      reminder_roster: [],
      workflow_trigger_mode: 'off',
    });
    expect(JSON.parse(settings.at(-1)!).run.system_prompt).toStartWith('the frozen prompt');
    yield* Effect.yieldNow;
    expect(sent.find((one) => one.method === 'approval/decide')?.params).toMatchObject({ choiceId: 'allow_once', approvalId: 'a1' });
    const kinds = seen.map((one) =>
      one.kind === 'update' ? (one.body as { update: { sessionUpdate: string } }).update.sessionUpdate : one.kind,
    );
    expect(kinds.indexOf('tool_call')).toBeLessThan(kinds.indexOf('_tagma/said'));
    expect(
      seen.find(
        (one) => one.kind === 'update' && (one.body as { update: { sessionUpdate: string } }).update.sessionUpdate === 'usage_update',
      )?.body,
    ).toMatchObject({
      update: { size: 1_000_000, _meta: { 'tagma/measured': { input: 100, cacheRead: 80, output: 10, reasoning: 2 } } },
    });
  }),
);

it.effect('a steer the turn ended before reading runs in the follow-up turn Muse opens for it, inside the same Tagma turn', () =>
  Effect.gen(function* () {
    const STEER = '01a19573-2e48-708d-9b8c-9be329a9e7e8';
    const first = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let ended = false;
    const { agent, sent } = yield* world((one, emit) => {
      const sessionId = one.params.sessionId;
      if (one.method === 'session/start') return ok(one, { session: { sessionId } });
      if (one.method === 'turn/start') return ok(one, { turnId: TURN, disposition: 'started' });
      if (one.method === 'turn/steer')
        return ended
          ? Effect.fail(new MuseRefused({ method: one.method, kind: 'commandRejected', code: -32030, message: 'already_terminal' }))
          : Effect.as(
              Effect.andThen(
                Effect.sync(() => {
                  ended = true;
                }),
                Effect.forkDetach(
                  Effect.gen(function* () {
                    yield* emit({ method: 'turn/completed', params: { sessionId, turnId: TURN, terminal: 'completed' } });
                    yield* Deferred.succeed(first, undefined);
                    yield* Deferred.await(release);
                    yield* emit({ method: 'turn/started', params: { sessionId, turnId: STEER } });
                    yield* emit({
                      method: 'item/completed',
                      params: {
                        sessionId,
                        item: {
                          itemId: 'u2',
                          kind: 'userMessage',
                          status: 'completed',
                          turnId: STEER,
                          commandId: STEER,
                          steered: true,
                          text: 'BANANA',
                        },
                      },
                    });
                    yield* emit({
                      method: 'approval/request',
                      request: true,
                      params: {
                        sessionId,
                        approvalId: 'a2',
                        turnId: STEER,
                        toolCallId: 'call_2',
                        toolName: 'mcp__tagma__echo',
                        rawArgs: '{}',
                        currentRequirementId: { approvalId: 'a2', sourceIndex: 0 },
                        availableChoices: [{ choiceId: 'allow_once', decision: 'approved', scope: 'once' }],
                        subject: { kind: 'tool' },
                      },
                    });
                    yield* emit({ method: 'turn/completed', params: { sessionId, turnId: STEER, terminal: 'completed' } });
                  }),
                ),
              ),
              { commandId: one.id, status: 'accepted', turnId: TURN },
            );
      return ok(one);
    });
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    const running = yield* Effect.forkChild(
      agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'go' }], _meta: { 'tagma/turn': TURN } }),
    );
    yield* Effect.yieldNow;
    const steer = agent.extensions!['_tagma/steer']!;
    const steered = yield* Effect.forkChild(
      steer({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'BANANA' }], input: STEER }),
    );
    yield* Deferred.await(first);
    yield* Effect.yieldNow;
    expect(sent.find((one) => one.method === 'turn/steer')).toMatchObject({ id: STEER, params: { expectedTurnId: TURN } });
    expect(running.pollUnsafe()).toBeUndefined();
    expect(steered.pollUnsafe()).toBeUndefined();
    yield* Deferred.succeed(release, undefined);
    expect(yield* Fiber.join(steered)).toEqual({ outcome: 'injected' });
    expect(yield* Fiber.join(running)).toMatchObject({ stopReason: 'end_turn' });
    yield* Effect.yieldNow;
    expect(sent.find((one) => one.method === 'approval/decide')?.params).toMatchObject({ approvalId: 'a2', choiceId: 'allow_once' });
    expect(sent.some((one) => one.method === 'turn/interrupt')).toBe(false);
    const late = yield* Effect.forkChild(
      agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'again' }], _meta: { 'tagma/turn': TURN } }),
    );
    yield* Effect.yieldNow;
    expect(yield* steer({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'late' }] })).toEqual({ outcome: 'promptRequired' });
    yield* Fiber.interrupt(late);
  }),
);

it.effect('a stop before the follow-up of an unread steer ends the turn and hands the steer back unread', () =>
  Effect.gen(function* () {
    const { agent } = yield* world((one, emit) => {
      const sessionId = one.params.sessionId;
      if (one.method === 'session/start') return ok(one, { session: { sessionId } });
      if (one.method === 'turn/start') return ok(one, { turnId: TURN, disposition: 'started' });
      if (one.method === 'turn/steer')
        return Effect.as(emit({ method: 'turn/completed', params: { sessionId, turnId: TURN, terminal: 'completed' } }), {
          commandId: one.id,
          status: 'accepted',
          turnId: TURN,
        });
      return ok(one);
    });
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    const running = yield* Effect.forkChild(
      agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'go' }], _meta: { 'tagma/turn': TURN } }),
    );
    yield* Effect.yieldNow;
    const steer = agent.extensions!['_tagma/steer']!;
    const steered = yield* Effect.forkChild(
      steer({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'late' }], input: '01a19573-2e48-708d-9b8c-9be329a9e7ea' }),
    );
    yield* Effect.yieldNow;
    expect(running.pollUnsafe()).toBeUndefined();
    yield* agent.cancel({ sessionId: session.sessionId });
    expect(yield* Fiber.join(running)).toMatchObject({ stopReason: 'cancelled' });
    expect(yield* Fiber.join(steered)).toEqual({ outcome: 'promptRequired' });
  }),
);

it.effect('a stop while the host is still opening ends the turn cancelled without handing its words to Muse', () =>
  Effect.gen(function* () {
    const opening = yield* Deferred.make<void>();
    const { agent, sent } = yield* world((one) => {
      if (one.method === 'session/start')
        return Effect.andThen(Deferred.await(opening), ok(one, { session: { sessionId: one.params.sessionId } }));
      return ok(one, { turnId: TURN, disposition: 'started' });
    });
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    const running = yield* Effect.forkChild(
      agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'go' }], _meta: { 'tagma/turn': TURN } }),
    );
    while (!sent.some((one) => one.method === 'session/start')) yield* Effect.yieldNow;
    yield* agent.cancel({ sessionId: session.sessionId });
    yield* Deferred.succeed(opening, undefined);
    expect(yield* Fiber.join(running)).toMatchObject({ stopReason: 'cancelled' });
    expect(sent.filter((one) => one.method === 'turn/start')).toEqual([]);
  }),
);

it.effect('a turn Muse only queued and a stop reclaimed leaves its opening unheard', () =>
  Effect.gen(function* () {
    const { agent, sent } = yield* world((one, emit) => {
      const sessionId = one.params.sessionId;
      if (one.method === 'session/start') return ok(one, { session: { sessionId } });
      if (one.method === 'turn/start') return ok(one, { turnId: TURN, disposition: 'queued' });
      if (one.method === 'turn/unqueue')
        return Effect.as(emit({ method: 'turn/unqueued', params: { sessionId, turnId: TURN } }), { commandId: one.id });
      return ok(one);
    });
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    const running = yield* Effect.forkChild(
      agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'go' }], _meta: { 'tagma/turn': TURN } }),
    );
    while (!sent.some((one) => one.method === 'turn/start')) yield* Effect.yieldNow;
    yield* Effect.yieldNow;
    yield* agent.cancel({ sessionId: session.sessionId });
    const answer = yield* Fiber.join(running);
    expect(answer).toMatchObject({ stopReason: 'cancelled' });
    expect(answer._meta).not.toHaveProperty('tagma/opened');
  }),
);

it.effect('a decision Muse refuses on a Tagma call fails the turn and stops it instead of leaving it waiting', () =>
  Effect.gen(function* () {
    const { agent, sent } = yield* world((one, emit) => {
      const sessionId = one.params.sessionId;
      if (one.method === 'session/start') return ok(one, { session: { sessionId } });
      if (one.method === 'turn/start')
        return Effect.as(
          Effect.forkDetach(
            emit({
              method: 'approval/request',
              request: true,
              params: {
                sessionId,
                approvalId: 'a1',
                turnId: TURN,
                toolCallId: 'call_1',
                toolName: 'mcp__tagma__echo',
                rawArgs: '{}',
                currentRequirementId: { approvalId: 'a1', sourceIndex: 0 },
                availableChoices: [{ choiceId: 'allow_once', decision: 'approved', scope: 'once' }],
                subject: { kind: 'tool', toolName: 'mcp__tagma__echo' },
              },
            }),
          ),
          { commandId: one.id, status: 'accepted', turnId: TURN, disposition: 'started' },
        );
      if (one.method === 'approval/decide')
        return Effect.fail(new MuseRefused({ method: one.method, kind: 'overloaded', code: -32050, message: 'host overloaded' }));
      return ok(one);
    });
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    const failed = yield* Effect.flip(
      agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'go' }], _meta: { 'tagma/turn': TURN } }),
    );
    expect(failed.message).toContain('refused the decision');
    while (!sent.some((one) => one.method === 'turn/interrupt')) yield* Effect.yieldNow;
  }),
);

it.effect('a stopped turn answers an accepted steer by what Muse holds of it, never handing back words its transcript already has', () =>
  Effect.gen(function* () {
    const STEER = '01a19573-2e48-708d-9b8c-9be329a9e7eb';
    const { agent, sent } = yield* world((one, emit) => {
      const sessionId = one.params.sessionId;
      if (one.method === 'session/start') return ok(one, { session: { sessionId } });
      if (one.method === 'turn/start') return ok(one, { turnId: TURN, disposition: 'started' });
      if (one.method === 'turn/steer') return ok(one, { turnId: TURN });
      if (one.method === 'turn/interrupt')
        return Effect.as(emit({ method: 'turn/completed', params: { sessionId, turnId: TURN, terminal: 'cancelled' } }), {
          commandId: one.id,
        });
      if (one.method === 'turn/unqueue')
        return Effect.fail(new MuseRefused({ method: one.method, kind: 'commandRejected', code: -32030, message: 'missing_run' }));
      if (one.method === 'session/read')
        return Effect.succeed({
          history: { items: [{ itemId: 'u2', kind: 'userMessage', commandId: STEER, steered: true }], snapshot: null },
        });
      return ok(one);
    });
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    const running = yield* Effect.forkChild(
      agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'go' }], _meta: { 'tagma/turn': TURN } }),
    );
    while (!sent.some((one) => one.method === 'turn/start')) yield* Effect.yieldNow;
    const steer = agent.extensions!['_tagma/steer']!;
    const steered = yield* Effect.forkChild(
      steer({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'late' }], input: STEER }),
    );
    while (!sent.some((one) => one.method === 'turn/steer')) yield* Effect.yieldNow;
    yield* agent.cancel({ sessionId: session.sessionId });
    expect(yield* Fiber.join(running)).toMatchObject({ stopReason: 'cancelled' });
    expect(yield* Fiber.join(steered)).toEqual({ outcome: 'injected' });
  }),
);

it.effect('a stop while Muse is still admitting a compaction ends it cancelled at once, and the session reads busy until then', () =>
  Effect.gen(function* () {
    const admitting = yield* Deferred.make<void>();
    const { agent, sent } = yield* world((one) => {
      if (one.method === 'session/start') return ok(one, { session: { sessionId: one.params.sessionId } });
      if (one.method === 'session/compact') return Effect.andThen(Deferred.await(admitting), ok(one));
      return ok(one);
    });
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    const compact = agent.extensions!['_tagma/compact']!;
    const compacting = yield* Effect.forkChild(compact({ sessionId: session.sessionId, instructions: '', at: 'end' }));
    while (!sent.some((one) => one.method === 'session/compact')) yield* Effect.yieldNow;
    const second = yield* Effect.flip(compact({ sessionId: session.sessionId, instructions: '', at: 'end' }));
    expect(second.message).toContain('busy');
    yield* agent.cancel({ sessionId: session.sessionId });
    expect((yield* Effect.flip(Fiber.join(compacting))).code).toBe(-32800);
  }),
);

it.effect('a steer Muse refuses after the turn completed under it still lets the turn end', () =>
  Effect.gen(function* () {
    const { agent } = yield* world((one, emit) => {
      const sessionId = one.params.sessionId;
      if (one.method === 'session/start') return ok(one, { session: { sessionId } });
      if (one.method === 'turn/start') return ok(one, { turnId: TURN, disposition: 'started' });
      if (one.method === 'turn/steer')
        return Effect.andThen(
          emit({ method: 'turn/completed', params: { sessionId, turnId: TURN, terminal: 'completed' } }),
          Effect.fail(new MuseRefused({ method: one.method, kind: 'commandRejected', code: -32030, message: 'already_terminal' })),
        );
      return ok(one);
    });
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    const running = yield* Effect.forkChild(
      agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'go' }], _meta: { 'tagma/turn': TURN } }),
    );
    yield* Effect.yieldNow;
    const steer = agent.extensions!['_tagma/steer']!;
    expect(
      yield* steer({
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'late' }],
        input: '01a19573-2e48-708d-9b8c-9be329a9e7e9',
      }),
    ).toEqual({
      outcome: 'promptRequired',
    });
    expect(yield* Fiber.join(running)).toMatchObject({ stopReason: 'end_turn' });
  }),
);

it.effect('a prompt that changed between runs restarts the host and resumes the same session before the turn', () =>
  Effect.gen(function* () {
    let prompt = 'first prompt';
    const turns = ['01a19573-1cea-7c2e-90b4-000000000001', '01a19573-1cea-7c2e-90b4-000000000002', '01a19573-1cea-7c2e-90b4-000000000003'];
    const { agent, sent, launches, settings } = yield* world(
      (one, emit) => {
        if (one.method === 'session/start' || one.method === 'session/resume')
          return ok(one, { session: { sessionId: one.params.sessionId, approvalMode: { mode: 'promptUnmatched' } } });
        if (one.method === 'turn/start')
          return Effect.as(
            Effect.forkDetach(
              emit({ method: 'turn/completed', params: { sessionId: one.params.sessionId, turnId: one.id, terminal: 'completed' } }),
            ),
            { commandId: one.id, status: 'accepted', turnId: one.id, disposition: 'started' },
          );
        return ok(one);
      },
      () => prompt,
    );
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    yield* agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'one' }], _meta: { 'tagma/turn': turns[0] } });
    yield* agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'two' }], _meta: { 'tagma/turn': turns[1] } });
    expect(launches).toHaveLength(1);
    prompt = 'second prompt';
    yield* agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'three' }], _meta: { 'tagma/turn': turns[2] } });
    expect(launches).toHaveLength(2);
    expect(JSON.parse(settings.at(-1)!).run.system_prompt).toStartWith('second prompt');
    expect(sent.filter((one) => one.method === 'session/resume').map((one) => one.params.sessionId)).toEqual([session.sessionId]);
  }),
);

it.effect('blank words never reach Muse, and a turn costs what Muse priced the session above the turn before', () =>
  Effect.gen(function* () {
    const turns = ['01a19573-1cea-7c2e-90b4-000000000021', '01a19573-1cea-7c2e-90b4-000000000022'];
    let usd = 0;
    const { agent, sent } = yield* world((one, emit) => {
      if (one.method === 'session/start') return ok(one, { session: { sessionId: one.params.sessionId } });
      if (one.method === 'turn/start') {
        usd += 0.25;
        const sessionId = one.params.sessionId;
        const usage = { inputTokens: 10, outputTokens: 1, cachedTokens: 0, reasoningTokens: 0 };
        return Effect.as(
          Effect.forkDetach(
            Effect.andThen(
              emit({
                method: 'session/tokenUsage',
                params: {
                  sessionId,
                  turnId: one.id,
                  modelId: null,
                  usage,
                  promptTokens: 10,
                  cumulative: { cost: { usd, partial: false } },
                },
              }),
              emit({ method: 'turn/completed', params: { sessionId, turnId: one.id, terminal: 'completed' } }),
            ),
          ),
          { commandId: one.id, status: 'accepted', turnId: one.id, disposition: 'started' },
        );
      }
      return ok(one);
    });
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    yield* agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'one' }], _meta: { 'tagma/turn': turns[0] } });
    const second = yield* agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: '  ' }],
      _meta: { 'tagma/turn': turns[1] },
    });
    expect(sent.filter((one) => one.method === 'turn/start').at(-1)?.params.input).toEqual([{ type: 'text', text: 'turn context' }]);
    expect(second._meta).toMatchObject({ 'tagma/cost': { amount: 0.25, currency: 'USD', basis: 'estimate' } });
  }),
);

it.effect('a side question runs in a side session on the thread model and answers with its text and spend', () =>
  Effect.gen(function* () {
    const { agent, sent } = yield* world((one, emit) => {
      if (one.method === 'session/start') return ok(one, { session: { sessionId: one.params.sessionId } });
      if (one.method === 'session/sideChat') return ok(one, { session: { sessionId: 'side-1' } });
      if (one.method === 'turn/start' && one.params.sessionId === 'side-1') {
        const usage = { inputTokens: 17_624, outputTokens: 5, cachedTokens: 0, reasoningTokens: 0 };
        return Effect.as(
          Effect.forkDetach(
            Effect.gen(function* () {
              yield* emit({
                method: 'session/tokenUsage',
                params: { sessionId: 'side-1', turnId: one.id, modelId: null, usage, promptTokens: 17_624 },
              });
              yield* emit({
                method: 'item/completed',
                params: {
                  sessionId: 'side-1',
                  item: { itemId: 'a', kind: 'agentMessage', status: 'completed', turnId: one.id, text: 'PELICAN-7' },
                },
              });
              yield* emit({ method: 'turn/completed', params: { sessionId: 'side-1', turnId: one.id, terminal: 'completed' } });
            }),
          ),
          { commandId: one.id, status: 'accepted', turnId: one.id, disposition: 'started' },
        );
      }
      return ok(one);
    });
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    const asked = yield* agent.extensions!['_tagma/aside']!({ sessionId: session.sessionId, question: 'What is the code word?' });
    expect(asked).toMatchObject({ text: 'PELICAN-7', usage: { inputTokens: 17_624, outputTokens: 5 } });
    expect(sent.find((one) => one.method === 'session/setModel' && one.params.sessionId === 'side-1')?.params).toMatchObject({
      model: { modelId: 'muse-spark-1.2' },
    });
  }),
);

it.effect('a tool whose definition changed under the same name restarts the host and resumes the same session', () =>
  Effect.gen(function* () {
    const turns = ['01a19573-1cea-7c2e-90b4-000000000011', '01a19573-1cea-7c2e-90b4-000000000012'];
    const { agent, sent, launches, catalog } = yield* world((one, emit) => {
      if (one.method === 'session/start' || one.method === 'session/resume')
        return ok(one, { session: { sessionId: one.params.sessionId, approvalMode: { mode: 'promptUnmatched' } } });
      if (one.method === 'turn/start')
        return Effect.as(
          Effect.forkDetach(
            emit({ method: 'turn/completed', params: { sessionId: one.params.sessionId, turnId: one.id, terminal: 'completed' } }),
          ),
          { commandId: one.id, status: 'accepted', turnId: one.id, disposition: 'started' },
        );
      return ok(one);
    });
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    yield* agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'one' }], _meta: { 'tagma/turn': turns[0] } });
    catalog.description = 'echo, now with a new contract';
    yield* agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'two' }], _meta: { 'tagma/turn': turns[1] } });
    expect(launches).toHaveLength(2);
    expect(sent.filter((one) => one.method === 'session/resume').map((one) => one.params.sessionId)).toEqual([session.sessionId]);
  }),
);

it.effect('a signed-out CLI ends the turn with an auth refusal that names muse login', () =>
  Effect.gen(function* () {
    const { agent } = yield* world((one, emit) => {
      if (one.method === 'session/start') return ok(one, { session: { sessionId: one.params.sessionId } });
      if (one.method === 'turn/start')
        return Effect.as(
          Effect.forkDetach(
            emit({
              method: 'turn/completed',
              params: {
                sessionId: one.params.sessionId,
                turnId: TURN,
                terminal: 'failed',
                error: { kind: 'authRequired', message: 'not logged in', retryable: false },
              },
            }),
          ),
          { commandId: one.id, status: 'accepted', turnId: TURN, disposition: 'started' },
        );
      return ok(one);
    });
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    const refused = yield* Effect.flip(
      agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'go' }], _meta: { 'tagma/turn': TURN } }),
    );
    expect(refused).toMatchObject({ code: -32000, data: { 'tagma/failure': { reason: { family: 'auth' } } } });
    expect(refused.message).toContain('muse login');
  }),
);
