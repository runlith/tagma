import type { ProgramOutcome, ThrownShape } from './channel.js';

const scalarBytes = (value: unknown): number => {
  if (value === null) return 1;
  switch (typeof value) {
    case 'string':
      return Buffer.byteLength(value, 'utf8');
    case 'number':
    case 'bigint':
      return 8;
    case 'boolean':
      return 1;
    case 'object':
      return ArrayBuffer.isView(value) || value instanceof ArrayBuffer ? value.byteLength : 0;
    default:
      return 0;
  }
};

export const thrownBytes = (thrown: ThrownShape): number =>
  scalarBytes(thrown.name) +
  scalarBytes(thrown.message) +
  scalarBytes(thrown.code) +
  scalarBytes(thrown.errno) +
  scalarBytes(thrown.constraint);

export const programOutcomeBytes = (outcome: ProgramOutcome): number => {
  switch (outcome._tag) {
    case 'Applied':
      return 'Applied'.length;
    case 'Conflict':
      return 'Conflict'.length + 3 * 8;
    case 'Refused':
      return 'Refused'.length + 8 + thrownBytes(outcome.thrown);
  }
};

const recordBytes = (record: object): number => {
  let bytes = 0;
  for (const key in record) {
    if (Object.hasOwn(record, key)) bytes += Buffer.byteLength(key, 'utf8') + scalarBytes((record as Record<string, unknown>)[key]);
  }
  return bytes;
};

export const parameterBytes = (params: ReadonlyArray<unknown>): number => {
  let bytes = 0;
  for (let index = 0; index < params.length; index++) {
    const value = params[index];
    bytes +=
      value !== null && typeof value === 'object' && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)
        ? recordBytes(value)
        : scalarBytes(value);
  }
  return bytes;
};

export const rowBytes = (rows: ReadonlyArray<unknown>): number => {
  let bytes = 0;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (Array.isArray(row)) {
      for (let column = 0; column < row.length; column++) bytes += scalarBytes(row[column]);
    } else {
      bytes += recordBytes(row as object);
    }
  }
  return bytes;
};
