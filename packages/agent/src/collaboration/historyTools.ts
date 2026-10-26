import { Effect, Schema } from 'effect';
import { Tool } from '../agent/tool';
import type { ToolCatalog } from '../agent/ToolCatalog';
import { threadAgentSubject } from '../permissions/threadSubject';
import type { ThreadRewindAnswer } from '../thread/rewind';
import type { ThreadPlaneAccess } from './ThreadPlaneAccess';
import { AgentAddress, raisedIds } from './collaborationVerbs';
import { NOT_A_DESCENDANT } from './collaborationVerbs';
import { addressed, addressedSoFar, crossingPrepared, hostCall } from './toolCalls';
import { ASKS_IN_REVIEW } from '../permissions/vocabulary';
import { CHILD_REFUSALS, planeRefusals } from './refusals';

const ThreadAddress = Schema.String.check(Schema.isMinLength(1));

function writes(agents: ThreadPlaneAccess, address: string) {
  return [{ kind: 'write' as const, value: threadAgentSubject(agents.ownerId, address) }];
}

export function historyTools(agents: ThreadPlaneAccess, childVerbs: boolean): ToolCatalog {
  const tools: ToolCatalog = {};
  if (childVerbs) {
    tools.rewind_agent = Tool.make({
      refusals: planeRefusals([...CHILD_REFUSALS, 'not-a-descendant', 'transport-cannot']),
      approval: { ...ASKS_IN_REVIEW, when: [NOT_A_DESCENDANT] },
      exposure: 'deferred',
      description:
        'Take turns out of a descendant’s model history: `from` takes the turn of run `at` and every later one, `turn` takes that one turn. ' +
        'A going run of it is stopped first; its queued words come back in the answer and nothing starts on its own. ' +
        'The turns stay readable in its feed, and its files and graph writes stay as they are.',
      parameters: Schema.Struct({
        threadId: AgentAddress,
        at: ThreadAddress.annotate({ description: 'The run whose turn the rewind reaches, as the descendant’s transcript names it.' }),
        scope: Schema.Literals(['from', 'turn']),
      }),
      prepare: (input, call) => crossingPrepared(agents, call.caller, writes(agents, input.threadId), input.threadId, 'descendant'),
      display: (input) => ({
        ...addressedSoFar(input.threadId),
        details: input.scope === undefined || input.at === undefined ? undefined : [{ label: input.scope, value: input.at }],
      }),
      execute: (input, call) =>
        hostCall(
          Effect.flatMap(agents.acting(call.caller), (verbs) =>
            verbs
              .rewind({
                threadId: input.threadId,
                at: input.at,
                scope: input.scope,
                key: call.toolCallId,
                asked: raisedIds(call.prepared),
              })
              .pipe(
                Effect.map(
                  (answer) =>
                    new Tool.ToolAnswer(answer, {
                      ...addressed(input.threadId, undefined, answer),
                      facts: rewoundFacts(answer),
                      details: [
                        { label: input.scope, value: input.at },
                        ...(answer.stopped === null ? [] : [{ label: 'stopped run', value: answer.stopped }]),
                      ],
                    }),
                ),
              ),
          ),
        ),
      mutates: true,
      confirmation: {
        prompt: (input) => ({
          summary:
            input.scope === 'from'
              ? `Take run ${input.at} and every later turn out of ${input.threadId}’s history?`
              : `Take the turn of run ${input.at} out of ${input.threadId}’s history?`,
          consequence: 'A going run of it is stopped first. Its files and graph writes stay as they are.',
        }),
        confirmLabel: 'Rewind',
      },
    });
  }
  return tools;
}

function rewoundFacts(answer: ThreadRewindAnswer): readonly { readonly label: string; readonly value: string }[] {
  return [
    { label: 'rewound', value: `${answer.runIds.length} run${answer.runIds.length === 1 ? '' : 's'}` },
    ...(answer.stopped === null ? [] : [{ label: 'stopped', value: 'its run' }]),
    ...(answer.taken.length === 0 ? [] : [{ label: 'taken back', value: `${answer.taken.length} queued` }]),
  ];
}
