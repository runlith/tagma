import { agentRule, type AgentRule } from '@runlith/agent/AgentRuntimePolicy';
import { reviewers, reviewWords, teamModelsWords } from '@runlith/agent/collaboration/team';
import { capabilityHolds } from '@runlith/agent/thread/agents/AgentDefinitions';
import { Effect, Hash, Schema } from 'effect';
import { toldState } from './guidance.js';
import { PEERS_CAPABILITY } from '../../threads/contract/wire/capability.js';
import type { ThreadTeams } from '../../threads/contract/service/team.js';
import type { ThreadContext } from './context.js';
import type { NativeRuleSource } from '../contract/service/rules.js';

const TOLD = 'team';
export const teamSource: NativeRuleSource = { id: TOLD, create: ({ teams }) => teamRule(teams) };
const told = Schema.Struct({ models: Schema.Number, review: Schema.Number });
type Told = typeof told.Type;
type Resolved = { readonly inputs: number; readonly reviewing: boolean };

const UNREVIEWED = Hash.string('none');

export function teamRule(teams: ThreadTeams['Service']): AgentRule<ThreadContext> {
  const seen = new Map<string, Told>();
  const resolved = new Map<string, Resolved>();
  return agentRule<ThreadContext>(
    TOLD,
    (ctx) =>
      Effect.gen(function* () {
        if (ctx.hook !== 'beforeStep' || !capabilityHolds(ctx.thread.profile?.overlay, { id: PEERS_CAPABILITY })) return null;
        const place = { threadId: ctx.thread.id, projectId: ctx.projectId };
        const layers = yield* teams.layers(place);
        const models = Hash.combine(Hash.string(JSON.stringify(layers.edits)), layers.connected.revision);
        const inputs = Hash.combine(models, Hash.string(JSON.stringify(layers.review)));
        const known = resolved.get(ctx.thread.id);
        const fresh = known === undefined || known.inputs !== inputs ? yield* teams.of(place, layers) : null;
        const reviewing = fresh === null ? known?.reviewing === true : reviewers(fresh).length > 0;
        resolved.set(ctx.thread.id, { inputs, reviewing });
        const current: Told = { models, review: reviewing ? inputs : UNREVIEWED };
        const last = toldState(ctx.modelMessages, TOLD, told) ?? seen.get(ctx.thread.id) ?? { models: current.models, review: UNREVIEWED };
        if (last.models === current.models && last.review === current.review) {
          seen.set(ctx.thread.id, current);
          return null;
        }
        const team = fresh ?? (yield* teams.of(place, layers));
        const text = [
          ...(last.models === current.models ? [] : [teamModelsWords(team)]),
          ...(last.review === current.review ? [] : [reviewWords(team)]),
        ].join(' ');
        seen.set(ctx.thread.id, current);
        return { type: 'guide' as const, text, state: { [TOLD]: current } };
      }),
    { owner: 'threads', hook: 'beforeStep', priority: -20, critical: false },
  );
}
