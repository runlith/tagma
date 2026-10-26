import type { ToolDisplay } from '@runlith/agent/tool/display';
import { Data, Effect } from 'effect';
import type { Caller } from '../wire/caller.js';
import type { OperationId } from '../wire/ids.js';
import { textLines } from '../wire/plainText.js';

export type TextBudget = { readonly bytes: number; readonly lines: number };

export type VoiceAt = { readonly caller: Caller; readonly operation: OperationId; readonly budget: TextBudget };

export class VoiceUnrendered extends Data.TaggedError('VoiceUnrendered')<{ readonly message: string }> {}

export const UNVOICED: unique symbol = Symbol('tagma/presentation/unvoiced');

export type Spoken = string | typeof UNVOICED;

export type Voice<Answer = unknown, Input = unknown, R = never> = (
  answer: Answer,
  input: Input,
  at: VoiceAt,
) => Effect.Effect<Spoken, VoiceUnrendered, R>;

const CUT = '… the answer goes on past what one reply carries; ask for its document (json) to read it whole.';

const CUT_BYTES = Buffer.byteLength(CUT, 'utf8');

export const within = (lines: Iterable<string>, budget: TextBudget): string => {
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    const room = budget.bytes - bytes - CUT_BYTES - 1;
    const size = kept.length + 2 > budget.lines || line.length > room ? null : Buffer.byteLength(line, 'utf8');
    if (size === null || size > room) {
      kept.push(CUT);
      break;
    }
    kept.push(line);
    bytes += size + 1;
  }
  return kept.join('\n');
};

export const said =
  <Answer>(text: (answer: Answer, caller: Caller) => Spoken): Voice<Answer, unknown> =>
  (answer, _input, at) =>
    Effect.sync(() => {
      const told = text(answer, at.caller);
      return told === UNVOICED ? UNVOICED : within(textLines(told), at.budget);
    });

export const saidLines =
  <Answer, Input>(lines: (answer: Answer, input: Input) => Iterable<string> | typeof UNVOICED): Voice<Answer, Input> =>
  (answer, input, at) =>
    Effect.sync(() => {
      const told = lines(answer, input);
      return told === UNVOICED ? UNVOICED : within(told, at.budget);
    });

export type Presentation<R = never> = {
  readonly voice: Voice<unknown, unknown, R> | null;
  readonly called: ((input: Partial<Record<string, unknown>>) => ToolDisplay) | null;
  readonly settled: (input: unknown, answer: unknown) => ToolDisplay | undefined;
  readonly negative: ((input: unknown, answer: unknown) => string) | null;
};

export type ModulePresentation<R = never> = {
  readonly operations?: readonly string[];
  readonly voice?: Voice<unknown, unknown, R>;
  readonly called?: (input: Partial<Record<string, unknown>>) => ToolDisplay;
  readonly settled?: (input: unknown, answer: unknown) => ToolDisplay | undefined;
  readonly negative?: (input: unknown, answer: unknown) => string;
};
