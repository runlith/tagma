import { Effect } from 'effect';
import {
  type Claim,
  doorAsked,
  Tool,
  type ToolAnswerOptions,
  type ToolEffectSettlement,
  type ToolFailed,
  type ToolSettleCall,
} from '../agent/tool';
import type { ToolCatalog } from '../agent/ToolCatalog';
import { threadAgentSubject } from '../permissions/threadSubject';
import { ASKS_IN_REVIEW, type PermissionSubject } from '../permissions/vocabulary';
import type { ToolDisplay } from '../tool/display';
import { FINAL_ANSWER_TOOL } from '../transcript/parts';
import { recipientsTitle, threadAgentLabel } from './agentLabel';
import {
  INTERRUPT_AGENT,
  NOT_A_DESCENDANT,
  OWN_LINEAGE,
  SEND_MESSAGE,
  SEND_TASK,
  compactWords,
  compactingTaskInput,
  interruptAgentInput,
  interruptQuestion,
  lineageRaised,
  messageQuestion,
  raisedIds,
  sendMessageInput,
  sendRefusal,
  sentOutput,
  sentText,
  summarizerFacts,
  taskInput,
  taskQuestion,
} from './collaborationVerbs';
import type { ThreadDeliveryPending, ThreadEnvelopeReceipt, ThreadSendIntent } from './ThreadEnvelopes';
import type { ThreadPlaneAccess, ThreadSendAnswer, ThreadSendCompacting } from './ThreadPlaneAccess';
import { acting, addressesOf, handed, recipientsReference, told } from './toolCalls';
import { INTERRUPT_REFUSALS, planeRefusals, SEND_REFUSALS, TASK_REFUSALS } from './refusals';

type TaskInput = {
  readonly to: readonly string[];
  readonly task: string;
  readonly wake?: boolean;
  readonly compact?: { readonly keep?: string };
};

export function sendTools(agents: ThreadPlaneAccess, childVerbs: boolean): ToolCatalog {
  const writes = (to: readonly string[]): readonly PermissionSubject[] =>
    to.map((address) => ({ kind: 'write', value: threadAgentSubject(agents.ownerId, address) }));
  const claimed = (to: readonly string[]): Effect.Effect<readonly Claim[]> =>
    Effect.succeed(to.map((address) => ({ on: { kind: 'key', key: threadAgentSubject(agents.ownerId, address) }, access: 'write' })));
  const settled = (
    call: ToolSettleCall<{ readonly to: unknown }>,
    ask: {
      readonly intent: ThreadSendIntent;
      readonly text: string;
      readonly final?: true;
      readonly compact?: ThreadSendCompacting['compact'];
    },
  ): Effect.Effect<ToolEffectSettlement, ToolFailed> =>
    acting(agents, call.caller, (verbs) =>
      Effect.map(verbs.messaging.settle({ ...ask, to: addressesOf(call.toolInput.to), key: call.toolCallId }), (settled) => {
        if (settled.status !== 'completed') return settled;
        const output = sentOutput(settled.output);
        return {
          status: 'completed',
          output: new Tool.ToolAnswer(output, undefined, told({ json: doorAsked(call.toolInput, 'json') }, sentText(output))),
        };
      }),
    );

  return {
    [FINAL_ANSWER_TOOL]: Tool.make({
      approval: ASKS_IN_REVIEW,
      description: SEND_MESSAGE,
      refusals: planeRefusals(SEND_REFUSALS),
      parameters: sendMessageInput,
      document: true,
      subjects: (input) => writes(addressesOf(input.to)),
      claims: (input) => claimed(addressesOf(input.to)),
      display: {
        streamFields: ['to', 'message'],
        project: (input) => handed(addressesOf(input.to), input.message),
      },
      execute: (input, call) =>
        acting(agents, call.caller, (verbs) =>
          verbs.messaging
            .send({
              to: input.to,
              intent: 'message',
              text: input.message,
              key: call.toolCallId,
              inReplyTo: input.inReplyTo,
              final: input.final === true ? true : undefined,
              wake: input.wake,
            })
            .pipe(Effect.map((answer) => answered(call, input.to, input.message, answer, input.final === true))),
        ),
      settleEffect: (call) =>
        settled(call, { intent: 'message', text: call.toolInput.message, final: call.toolInput.final === true ? true : undefined }),
      mutates: true,
      confirmation: { prompt: messageQuestion, confirmLabel: 'Send' },
    }),

    send_task: Tool.make({
      refusals: planeRefusals(TASK_REFUSALS),
      approval: { ...ASKS_IN_REVIEW, when: [NOT_A_DESCENDANT] },
      exposure: 'deferred',
      description: SEND_TASK + (childVerbs ? compactWords(agents.summarizerChoice) : ''),
      parameters: childVerbs ? compactingTaskInput : taskInput,
      document: true,
      claims: (input) => {
        const { to }: TaskInput = input;
        return claimed(to);
      },
      prepare: (input, call) => {
        const { to, compact }: TaskInput = input;
        return compact === undefined
          ? Effect.succeed({ subjects: writes(to), prepared: [] })
          : acting(agents, call.caller, (verbs) =>
              Effect.map(verbs.messaging.aheadCrossing(to), (raised) => ({ subjects: writes(to), raised, prepared: raised })),
            );
      },
      display: {
        streamFields: ['to', 'task'],
        project: (input) => handed(addressesOf(input.to), input.task),
      },
      execute: (input, call) => {
        const { to, task, wake, compact }: TaskInput = input;
        return acting(agents, call.caller, (verbs) =>
          verbs.messaging
            .send({
              to,
              intent: 'task',
              text: task,
              key: call.toolCallId,
              wake,
              compact: compact,
              asked: compact === undefined ? undefined : raisedIds(call.prepared),
            })
            .pipe(Effect.map((answer) => answered(call, to, task, answer))),
        );
      },
      settleEffect: (call) => {
        const { task, compact }: TaskInput = call.toolInput;
        return settled(call, { intent: 'task', text: task, compact: compact });
      },
      mutates: true,
      confirmation: { prompt: (input) => taskQuestion(input), confirmLabel: 'Send' },
    }),

    interrupt_agent: Tool.make({
      approval: { ...ASKS_IN_REVIEW, when: [OWN_LINEAGE] },
      exposure: 'deferred',
      description: INTERRUPT_AGENT,
      refusals: planeRefusals(INTERRUPT_REFUSALS),
      parameters: interruptAgentInput,
      document: true,
      claims: (input) => claimed(input.to),
      prepare: (input, call) =>
        acting(agents, call.caller, (verbs) =>
          Effect.map(verbs.messaging.lineage(input.to), (found) => ({ subjects: writes(input.to), raised: lineageRaised(found) })),
        ),
      display: {
        streamFields: ['to', 'reason'],
        project: (input) => handed(addressesOf(input.to), input.reason),
      },
      execute: (input, call) =>
        acting(agents, call.caller, (verbs) =>
          verbs.messaging
            .send({ to: input.to, intent: 'interrupt', text: input.reason, key: call.toolCallId })
            .pipe(Effect.map((answer) => answered(call, input.to, input.reason, answer))),
        ),
      settleEffect: (call) => settled(call, { intent: 'interrupt', text: call.toolInput.reason }),
      mutates: true,
      confirmation: { prompt: interruptQuestion, confirmLabel: 'Interrupt' },
    }),
  };
}

export function answered(
  call: { readonly json?: boolean },
  to: readonly string[],
  text: string,
  answer: ThreadSendAnswer,
  final = false,
): Tool.ToolAnswer {
  const refusal = sendRefusal(answer);
  const output = sentOutput(answer);
  const options: ToolAnswerOptions = { ...told(call, sentText(output)), ...(refusal === undefined ? {} : { refusal }) };
  return new Tool.ToolAnswer(output, deliveredDisplay(to, text, answer, final), options);
}

function deliveredDisplay(to: readonly string[], text: string, answer: ThreadSendAnswer, final: boolean): ToolDisplay {
  if (answer.status === 'refused') return handed(to, text);
  if (answer.status === 'not-found') return { ...handed(to, text), facts: [{ label: 'no agent', value: answer.addresses.join(', ') }] };
  const { deliveries } = answer;
  const [first] = deliveries;
  const single = first !== undefined && first.status !== 'pending' && deliveries.length === 1 ? first : undefined;
  const undelivered = deliveries.filter((receipt) => receipt.status === 'pending');
  return {
    ...handed(to, text),
    verb: final ? 'Reported to' : undefined,
    title: recipientsTitle(deliveries.map((receipt) => threadAgentLabel(receipt.recipient))),
    reference: recipientsReference(
      deliveries.map(({ recipient }) => ({
        address: recipient.name ?? recipient.threadId,
        id: recipient.threadId,
        ...(recipient.projectId === undefined ? {} : { projectId: recipient.projectId }),
      })),
    ),
    facts:
      undelivered.length === 0
        ? undefined
        : [{ label: 'not delivered', value: undelivered.map((receipt) => threadAgentLabel(receipt.recipient)).join(', ') }],
    details: [
      { label: 'delivery', value: deliveryWords(deliveries) },
      ...deliveries.map((receipt) => ({ label: 'envelope', value: receipt.envelopeId })),
      ...(deliveries.some((receipt) => !receipt.recipient.sameTeam) ? [{ label: 'team', value: 'other' }] : []),
      ...(single?.closed !== undefined
        ? [{ label: 'final', value: `closed ${single.closed.length} request${single.closed.length === 1 ? '' : 's'}` }]
        : []),
      ...(single?.compaction !== undefined
        ? [
            { label: 'behind', value: single.compaction.runId === null ? 'a queued compaction' : `compaction ${single.compaction.runId}` },
            ...(single.compaction.summarizer === null ? [] : summarizerFacts(single.compaction.summarizer)),
          ]
        : []),
    ],
  };
}

function deliveryWords(deliveries: readonly (ThreadEnvelopeReceipt | ThreadDeliveryPending)[]): string {
  const counted = new Map<string, number>();
  for (const receipt of deliveries) counted.set(receipt.status, (counted.get(receipt.status) ?? 0) + 1);
  if (deliveries.length === 1) return [...counted.keys()].join('');
  return [...counted].map(([status, count]) => `${status} ${count}`).join(' · ');
}
