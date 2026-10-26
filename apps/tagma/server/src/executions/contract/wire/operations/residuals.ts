import { Schema } from 'effect';
import { ResidualInput } from '@runlith/executions/protocol/stop';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { ResidualEnded, ResidualsEnded } from '../residuals.js';
import { TERMINAL_REFUSALS } from '../refusals.js';
import { OPERATOR_DOORS } from './shape.js';
import { ASKS_IN_REVIEW } from '../../../../platform/contract/wire/conditions.js';

const operatorAct = {
  doors: OPERATOR_DOORS,
  callers: 'operator',
  subject: 'none',
  place: 'machine',
  graph: 'none',
  waits: [],
  lifetimes: [],
  effect: 'write',
  identity: { key: 'call' },
  subjects: () => [],
} as const;

const REFUSALS = [...TERMINAL_REFUSALS, 'body-shape'] as const;

const WAY_OUT = `The host proves the process again before every signal it sends, from the start witness the ending reported, and refuses one it cannot prove: a pid the kernel handed to another process, an identity nobody witnessed, or a process that is not one of the execution's reported residuals. It names which. Nothing here signals a pid on a caller's word alone.
This act keeps no operation key: the outcome of a lost reply is read by asking again, which finds the residual gone (\`Ended\` or \`Refused\` \`not-residual\`) or still standing.`;

const RESIDUAL_CONSEQUENCE =
  "It ends the residual process down the host's ladder (terminate, then kill) and reports the step it ended at; a process that survives the ladder is reported as surviving, never as ended.";

export const RESIDUAL_OPERATIONS = {
  end_residual: operation('end_residual', {
    approval: ASKS_IN_REVIEW,
    ...operatorAct,
    meaning: 'End one process an execution left running after its ending, proven against the start witness the ending reported.',
    grammar: WAY_OUT,
    input: Schema.Struct(ResidualInput.fields),
    answer: arms({ ok: ResidualEnded.fields }),
    refusals: REFUSALS,
    confirmation: (input: { readonly pid: number }) => ({
      summary: `End residual process ${input.pid}?`,
      consequence: RESIDUAL_CONSEQUENCE,
    }),
    confirmLabel: 'End process',
    intent: 'destructive',
    destructiveConsequence: () => RESIDUAL_CONSEQUENCE,
    presentation: { running: 'Ending a residual process', done: 'Ended a residual process' },
  }),

  end_residuals: operation('end_residuals', {
    approval: ASKS_IN_REVIEW,
    ...operatorAct,
    meaning: 'End several residual processes, each proven on its own, three at a time, and answer one outcome per process.',
    grammar: `${WAY_OUT}
One residual failing or being refused never stops the others: each entry answers its own outcome, in the order asked, and one the host could not be asked answers \`Unreached\` with the failure. At most as many entries as one load frame can name are taken.`,
    input: Schema.Struct({ residuals: Schema.Array(Schema.Struct(ResidualInput.fields)).check(Schema.isMinLength(1)) }),
    answer: arms({ ok: ResidualsEnded.fields }),
    refusals: REFUSALS,
    confirmation: (input: { readonly residuals: ReadonlyArray<unknown> }) => ({
      summary: `End ${input.residuals.length} residual processes?`,
      consequence: RESIDUAL_CONSEQUENCE,
    }),
    confirmLabel: 'End all',
    intent: 'destructive',
    destructiveConsequence: () => RESIDUAL_CONSEQUENCE,
    presentation: { running: 'Ending residual processes', done: 'Ended residual processes' },
  }),
};

export type ResidualOperationId = keyof typeof RESIDUAL_OPERATIONS;
