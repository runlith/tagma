import { agentRule, type AgentRule } from '@runlith/agent/AgentRuntimePolicy';
import { reviewWords, teamModelsWords } from '@runlith/agent/collaboration/team';
import { Effect, Hash, Schema } from 'effect';
import { toldState } from './guidance.js';
import type { ThreadTeams, TeamLayers } from '../../threads/contract/service/team.js';
import type { ThreadContext } from './context.js';
import type { NativeRuleSource } from '../contract/service/rules.js';

const TOLD = 'team';
export const teamSource: NativeRuleSource = { id: TOLD, create: ({ teams }) => teamRule(teams) };
const told = Schema.Struct({ models: Schema.Number, review: Schema.Number });
type Told = typeof told.Type;

const UNREVIEWED = Hash.string('none');

function standing({ edits, review, connected }: TeamLayers): Told {
  const models = Hash.combine(Hash.string(JSON.stringify(edits)), connected.revision);
  return {
    models,
    review: review.reviewers === 0 || review.pool.length === 0 ? UNREVIEWED : Hash.combine(models, Hash.string(JSON.stringify(review))),
  };
}

export function teamRule(teams: ThreadTeams['Service']): AgentRule<ThreadContext> {
  const seen = new Map<string, Told>();
  return agentRule<ThreadContext>(
    TOLD,
    (ctx) =>
      Effect.gen(function* () {
        if (ctx.hook !== 'beforeStep') return null;
        const place = { threadId: ctx.thread.id, projectId: ctx.projectId };
        const layers = yield* teams.layers(place);
        const current = standing(layers);
        const last = toldState(ctx.modelMessages, TOLD, told) ?? seen.get(ctx.thread.id) ?? { models: current.models, review: UNREVIEWED };
        if (last.models === current.models && last.review === current.review) {
          seen.set(ctx.thread.id, current);
          return null;
        }
        const team = yield* teams.of(place, layers);
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
