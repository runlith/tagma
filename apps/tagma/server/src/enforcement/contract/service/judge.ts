import { Context, type Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { HeadSubject, TreeSubject } from '../wire/checks.js';
import type { TerminalActor } from '../../../executions/contract/wire/terminals.js';
import type { BuiltTree } from '../../judging/trees.js';
import type { GateMemory } from '../../judging/gateMemory.js';
import type { Built, JudgedPhase, JudgeGraph, Judgement, headJudgement } from '../../judging/judge.js';

export class RuleJudgement extends Context.Service<
  RuleJudgement,
  {
    built(
      graphOf: JudgeGraph,
      memory: GateMemory['Service'] | undefined,
      git: Git['Service'],
    ): <E extends { readonly message: string }>(
      op: string,
      projectId: number,
      root: string,
      build: Effect.Effect<BuiltTree, E, Git>,
      phase: JudgedPhase,
      caller: TerminalActor | undefined,
    ) => Effect.Effect<Built>;
    over(
      graphOf: JudgeGraph,
      memory?: GateMemory['Service'],
    ): (op: string, subject: TreeSubject | HeadSubject, phase?: JudgedPhase) => Effect.Effect<Judgement>;
    head(op: string, subject: HeadSubject): ReturnType<typeof headJudgement>;
  }
>()('tagma/enforcement/RuleJudgement') {}
