import type { Words } from '@tagma/server/platform/contract/wire/refusal';
import type { Act, Told } from './told.js';

export class Refusal extends Error {
  readonly gate: boolean;
  readonly code: string;
  readonly reason: string;
  readonly unblock: string[];
  readonly inputFile?: string;
  readonly words?: Words;
  readonly field?: string;
  readonly note?: string;
  readonly act?: Act;

  constructor(input: {
    gate: boolean;
    code: string;
    reason: string;
    unblock: readonly string[];
    inputFile?: string;
    words?: Words;
    field?: string;
    note?: string;
    act?: Act;
    cause?: unknown;
  }) {
    super(`${input.code}: ${input.reason}`, { cause: input.cause });
    this.name = 'Refusal';
    this.gate = input.gate;
    this.code = input.code;
    this.reason = input.reason;
    this.unblock = [...input.unblock];
    this.inputFile = input.inputFile;
    this.words = input.words;
    this.field = input.field;
    this.note = input.note;
    this.act = input.act;
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
    const body = value as { code: string; reason: string; unblock?: readonly string[]; inputFile?: string; words?: Words; field?: string };
    return new Refusal({
      gate: body.code !== 'not-found',
      code: body.code,
      reason: body.reason,
      unblock: body.unblock ?? [],
      inputFile: body.inputFile,
      words: body.words,
      field: body.field,
    });
  }
  return new Refusal({
    gate: false,
    code: 'http',
    reason: value instanceof Error ? value.message : String(value),
    unblock: [],
  });
}
