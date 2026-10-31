import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { agentRuntimeGuidanceMessage } from '@runlith/agent/AgentSignal';
import type { AgentRuleAnswer } from '@runlith/agent/AgentRuntimePolicy';
import { enabledModels, reviewers, type TeamEdit } from '@runlith/agent/collaboration/team';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { Message } from '@runlith/llm/schema/messages';
import { graphFixture } from '../graphFixture.js';
import { builtinRegistry } from '../providerCatalog.js';
import { teamRule } from '../../../native-harness/testing/doubles.js';
import { makeThreadTeams } from '../../../threads/testing/doubles.js';
import { teamModels, teamReview } from '../../../threads/contract/wire/settings.js';
import { threadStack } from '../threadParts.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { ENTRY_KINDS } from '../../manifest.js';
import { type AccountRows, ProviderAccounts } from '../../../providers/contract/service/accounts.js';
import { makeConnectedProviders } from '../../../providers/accounts/connected.js';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { ThreadMandate } from '../../../threads/contract/service/mandate.js';

const CONNECTED = 'anthropic';
const OPUS_HIGH = { provider: CONNECTED, model: 'claude-opus-5-5', reasoning: 'high' } as const;
const OPUS_XHIGH = { ...OPUS_HIGH, reasoning: 'xhigh' } as const;

const ACCOUNT = {
  key: AccountKey.make('me'),
  label: 'me@example.com',
  origin: { kind: 'own' as const },
  secret: 'subscription' as const,
  fingerprint: 'me',
  enrollment: '1',
  durable: true,
  problem: null,
};

const standing = Effect.fnUntraced(function* () {
  const files = yield* FileSystem.FileSystem;
  const credentials = yield* files.makeTempDirectoryScoped();
  yield* files.utimes(credentials, new Date(1), new Date(1));
  const signed = new Set<string>([CONNECTED]);
  const signIn = (provider: string) =>
    Effect.andThen(
      Effect.sync(() => signed.add(provider)),
      files.writeFileString(join(credentials, 'tokens.json'), JSON.stringify([...signed])),
    ).pipe(Effect.orDie);
  const lifetime = graphFixture();
  const demo = yield* Effect.map(
    Effect.acquireRelease(lifetime.openEffect(), () => Effect.orDie(lifetime.releaseEffect)),
    (demo) => demo.effects,
  );
  const records = yield* Effect.provide(makeThreadRecords, demo.context);
  const { store, threads } = yield* Effect.provide(
    threadStack({ db: demo.graph.store.db, units: demo.graph.units, records, kinds: ENTRY_KINDS }),
    demo.context,
  );
  const [root, child, stranger] = yield* demo.graph.units
    .write('team.standing', (unit) =>
      Effect.gen(function* () {
        const root = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
        yield* threads.rows.attachFacet({ threadId: root.id, projectId: demo.projectId }, unit);
        const child = yield* store.insertChild(root.id, { ownerId: 'operator', agentId: 'tagma' }, unit);
        yield* threads.rows.inheritFacet({ threadId: child.id, fromThreadId: root.id, agentId: 'tagma' }, unit);
        const stranger = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
        yield* threads.rows.attachFacet({ threadId: stranger.id, projectId: demo.projectId }, unit);
        return [root.id, child.id, stranger.id] as const;
      }),
    )
    .pipe(Effect.orDie);
  const registry = Context.get(yield* Layer.build(builtinRegistry), ProviderRegistry);
  const rows: AccountRows = { of: (provider) => Effect.succeed(signed.has(provider) ? [ACCOUNT] : []) };
  const accounts = ProviderAccounts.of({ ...rows, connected: yield* makeConnectedProviders({ rows, registry, directory: credentials }) });
  const teams = yield* Effect.provide(
    makeThreadTeams(),
    Context.make(Settings, demo.graph.settings).pipe(
      Context.add(ThreadMandate, threads.mandate),
      Context.add(ProviderRegistry, registry),
      Context.add(ProviderAccounts, accounts),
    ),
  );
  const write = (scope: 'user' | 'project', key: 'agent.models' | 'agent.review', value: unknown) =>
    demo.graph.settings.write({ scope, key, value, projectId: scope === 'project' ? demo.projectId : undefined }).pipe(Effect.orDie);
  const team = (threadId: string) => teams.of({ threadId, projectId: demo.projectId }).pipe(Effect.orDie);
  return { demo, threads, teams, root, child, stranger, write, team, signIn };
}, Effect.provide(BunFileSystem.layer));

const opusHigh = (models: readonly { provider: string; model: string; reasoning: string | null }[]) =>
  models.find((row) => row.provider === OPUS_HIGH.provider && row.model === OPUS_HIGH.model && row.reasoning === OPUS_HIGH.reasoning);

it.live(
  'a thread resolves the shipped rows of connected providers under the machine and project edits, or under the copy its lineage holds; the machine alone resolves without the project’s',
  Effect.fnUntraced(function* () {
    const { threads, teams, root, child, stranger, write, team } = yield* standing();
    expect(new Set((yield* team(stranger)).models.map((row) => row.provider))).toEqual(new Set([CONNECTED]));
    yield* write('user', 'agent.models', [{ ...OPUS_HIGH, depth: 2, taste: 3, on: true }] satisfies TeamEdit[]);
    yield* write('project', 'agent.models', [{ ...OPUS_HIGH, depth: 4, on: false }] satisfies TeamEdit[]);
    yield* threads.mandate
      .setTeam(root, {
        models: [
          { ...OPUS_HIGH, depth: 2, taste: 3, on: true },
          { ...OPUS_XHIGH, reviews: true },
        ],
        review: { reviewers: 1, lenses: [] },
      })
      .pipe(Effect.orDie);
    yield* write('project', 'agent.models', [{ ...OPUS_HIGH, depth: 5, on: false }] satisfies TeamEdit[]);
    const outside = yield* team(stranger);
    expect(opusHigh(outside.models)).toMatchObject({ depth: 5, taste: 3, on: false, shipped: { depth: 8, taste: 9 } });
    expect(reviewers(outside)).toEqual([]);
    const machine = yield* teams.of({ threadId: null, projectId: undefined }).pipe(Effect.orDie);
    expect(opusHigh(machine.models)).toMatchObject({ depth: 2, taste: 3, on: true });
    const inside = yield* team(child);
    expect(opusHigh(enabledModels(inside))).toMatchObject({ depth: 2, taste: 3, on: true });
    expect(reviewers(inside).map((row) => row.reasoning)).toEqual(['xhigh']);
  }),
);

it.live(
  'using a thread’s copy for all threads makes it the project’s own, drops the copy, and its previous value undoes it',
  Effect.fnUntraced(function* () {
    const { demo, threads, teams, root, stranger, write, team } = yield* standing();
    const machine: TeamEdit[] = [{ ...OPUS_HIGH, depth: 2 }];
    const project: TeamEdit[] = [{ ...OPUS_HIGH, taste: 3 }];
    const change: TeamEdit = { ...OPUS_XHIGH, on: true, reviews: true };
    const review = { reviewers: 1, lenses: [] };
    yield* write('user', 'agent.models', machine);
    yield* write('project', 'agent.models', project);
    yield* threads.mandate.setTeam(root, { models: [...machine, ...project, change], review }).pipe(Effect.orDie);
    const copied = yield* team(root);
    const answer = yield* teams.promote(root, demo.projectId).pipe(Effect.orDie);
    expect(answer.previous).toEqual({ models: project, review: null });
    expect((yield* threads.mandate.teamLineage(root).pipe(Effect.orDie)).nearest).toBeNull();
    const own = (yield* demo.graph.settings.read(teamModels, demo.projectId).pipe(Effect.orDie)).layers.project?.value;
    expect(own).toEqual([...project, change]);
    expect(yield* team(stranger)).toEqual(copied);
    yield* write('project', 'agent.models', answer.previous.models);
    yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: teamReview.id }).pipe(Effect.orDie);
    expect(reviewers(yield* team(stranger))).toEqual([]);
    expect(enabledModels(yield* team(stranger)).some((row) => row.reasoning === 'xhigh')).toBe(false);
  }),
);

it.live(
  'an account connected while the agent works reaches it at its next step with that provider’s rows',
  Effect.fnUntraced(function* () {
    const { demo, teams, root, team, signIn } = yield* standing();
    const rule = teamRule(teams);
    const history: Message[] = [Message.user('Build it.')];
    const step = () =>
      rule({ hook: 'beforeStep', modelMessages: history, projectId: demo.projectId, thread: { id: root } } as unknown as Parameters<
        typeof rule
      >[0]);
    expect(yield* step()).toBeNull();
    expect((yield* team(root)).models.some((row) => row.provider === 'openai')).toBe(false);
    yield* signIn('openai');
    const told = yield* step();
    if (told === null || !('type' in told) || told.type !== 'guide') return yield* Effect.die('no single guide');
    history.push(agentRuntimeGuidanceMessage(told.text, told.state));
    expect((yield* team(root)).models.some((row) => row.provider === 'openai')).toBe(true);
    expect(yield* step()).toBeNull();
  }),
);

it.live(
  'a working agent is told once when its team moves from what it was last told, and nothing while it stands',
  Effect.fnUntraced(function* () {
    const { demo, teams, root, write } = yield* standing();
    const rule = teamRule(teams);
    const history: Message[] = [Message.user('Build it.')];
    const step = () =>
      rule({
        hook: 'beforeStep',
        modelMessages: history,
        projectId: demo.projectId,
        thread: { id: root },
      } as unknown as Parameters<typeof rule>[0]);
    const told = (directive: AgentRuleAnswer): void => {
      if (directive === null || !('type' in directive) || directive.type !== 'guide') throw new Error('expected a line');
      history.push(agentRuntimeGuidanceMessage(directive.text, directive.state));
    };
    const reviewTold = () => (history.at(-1)?.metadata?.runtimeState as { team: { review: number } }).team.review;
    expect(yield* step()).toBeNull();
    yield* write('project', 'agent.models', [{ ...OPUS_HIGH, on: true }] satisfies TeamEdit[]);
    told(yield* step());
    const unreviewed = reviewTold();
    expect(yield* step()).toBeNull();
    yield* write('project', 'agent.models', [{ ...OPUS_HIGH, on: true, reviews: true }] satisfies TeamEdit[]);
    told(yield* step());
    const reviewing = reviewTold();
    expect(reviewing).not.toBe(unreviewed);
    expect(yield* step()).toBeNull();
    yield* write('project', 'agent.review', { reviewers: 2, lenses: ['tests'] });
    told(yield* step());
    expect(reviewTold()).not.toBe(reviewing);
    yield* write('project', 'agent.review', { reviewers: 0, lenses: ['tests'] });
    told(yield* step());
    expect(reviewTold()).toBe(unreviewed);
    expect(yield* step()).toBeNull();
  }),
);
