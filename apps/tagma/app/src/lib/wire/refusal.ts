import type { Words } from '@tagma/server/platform/contract/wire/refusal';
import type { Right } from '@tagma/server/platform/contract/wire/right';
import type { Act, Told } from './told.js';

type RefusalInput = {
  gate: boolean;
  code: string;
  reason: string;
  unblock: readonly string[];
  inputFile?: string;
  words?: Words;
  field?: string;
  right?: Right;
  note?: string;
  act?: Act;
  cause?: unknown;
};

export class Refusal extends Error {
  readonly gate: boolean;
  readonly code: string;
  readonly reason: string;
  readonly unblock: string[];
  readonly inputFile?: string;
  readonly words?: Words;
  readonly field?: string;
  readonly right?: Right;
  readonly note?: string;
  readonly act?: Act;

  constructor(input: RefusalInput) {
    super(`${input.code}: ${input.reason}`, { cause: input.cause });
    this.name = 'Refusal';
    this.gate = input.gate;
    this.code = input.code;
    this.reason = input.reason;
    this.unblock = [...input.unblock];
    this.inputFile = input.inputFile;
    this.words = input.words;
    this.field = input.field;
    this.right = input.right;
    this.note = input.note;
    this.act = input.act;
  }

  hinted(hint: { readonly note?: string; readonly act?: Act }): Refusal {
    return new Refusal({
      gate: this.gate,
      code: this.code,
      reason: this.reason,
      unblock: this.unblock,
      inputFile: this.inputFile,
      words: this.words,
      field: this.field,
      right: this.right,
      note: hint.note ?? this.note,
      act: hint.act ?? this.act,
      cause: this.cause,
    });
  }

  get told(): Told {
    return {
      text: this.words?.text ?? this.reason,
      note: this.note,
      act: this.act,
      settings: this.words?.settings,
      details: [
        ...(this.words === undefined ? [] : [this.reason]),
        ...this.unblock,
        ...(this.inputFile === undefined ? [] : [this.inputFile]),
      ],
      code: this.code,
    };
  }
}

export const toldOf = (error: unknown): Told =>
  error instanceof Refusal ? error.told : { text: error instanceof Error ? error.message : String(error), details: [] };

export const RETRIES = 3;

export const retriable = (error: unknown): boolean => !(error instanceof Refusal) || error.code === 'http' || error.code === 'transport';

export function refusalOf(value: unknown): Refusal {
  if (value instanceof Refusal) return value;
  if (typeof value === 'object' && value !== null && 'code' in value && 'reason' in value) {
    const body = value as {
      code: string;
      reason: string;
      unblock?: readonly string[];
      inputFile?: string;
      words?: Words;
      field?: string;
      right?: Right;
    };
    return new Refusal({
      gate: body.code !== 'not-found',
      code: body.code,
      reason: body.reason,
      unblock: body.unblock ?? [],
      inputFile: body.inputFile,
      words: body.words,
      field: body.field,
      right: body.right,
    });
  }
  return new Refusal({
    gate: false,
    code: 'http',
    reason: value instanceof Error ? value.message : String(value),
    unblock: [],
  });
}
