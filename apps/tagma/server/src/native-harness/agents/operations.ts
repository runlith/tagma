import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { body, type OperationPair, pair } from '../../platform/contract/service/body.js';
import { callerReads } from '../../platform/contract/service/subjects.js';
import { CallerChangeWork, ChangeRecord } from '../../change-record/contract/service/record.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { agentSource } from '../../threads/operations/agents.js';
import { declaredRefusals } from '../../threads/refusalAnswers.js';
import { NativeAgentDefinitions } from '../contract/service/agents.js';
import { NATIVE_AGENT_OPERATIONS as OPS, type NativeAgentOperationId } from '../contract/wire/operations/agents.js';

export const NATIVE_AGENT_PAIRS: { readonly [K in NativeAgentOperationId]: OperationPair<(typeof OPS)[K]> } = {
  read_thread_agent: pair(
    OPS.read_thread_agent,
    body(OPS.read_thread_agent, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const preview = yield* declaredRefusals(OPS.read_thread_agent)(
          (yield* NativeAgentDefinitions).thread(call.project.id, input.threadId),
        );
        return { status: 'ok' as const, ...preview };
      }),
    }),
  ),
  save_agent: pair(
    OPS.save_agent,
    body(OPS.save_agent, {
      files: (input, caller) => callerReads(caller, input.sourceFile),
      prepare: Effect.fn('save_agent.prepare')(function* (input) {
        const call = yield* yield* CurrentProject;
        return yield* declaredRefusals(OPS.save_agent)(
          (yield* NativeAgentDefinitions).destination(call.project.id, input.name, input.scope),
        );
      }),
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const call = yield* yield* CurrentProject;
        const source = yield* agentSource(input, caller);
        if (source === undefined) {
          return yield* new GateRefusal('agent-source', 'Saving an agent requires its declaration.', ['Name source or sourceFile.']);
        }
        const record = yield* ChangeRecord;
        const work = yield* CallerChangeWork;
        const definition = yield* declaredRefusals(OPS.save_agent)(
          (yield* NativeAgentDefinitions).save(
            call.project.id,
            { name: input.name, scope: input.scope, revision: input.revision, source },
            work === null ? undefined : record.changes(work),
          ),
        );
        return { status: 'ok' as const, ...definition };
      }),
    }),
  ),
};
