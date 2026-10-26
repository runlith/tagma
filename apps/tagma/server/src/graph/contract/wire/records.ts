import { Schema } from 'effect';
import { line } from './fields.js';

export const reflectionPayloadSchema = Schema.Struct({
  command: line,
  expected: line,
  actual: line,
});
export type ReflectionPayload = typeof reflectionPayloadSchema.Type;

export const researchSourceSchema = Schema.Struct({ name: line, ref: line });
export type ResearchSource = typeof researchSourceSchema.Type;
export const researchPayloadSchema = Schema.Struct({ source: researchSourceSchema });
export type ResearchPayload = typeof researchPayloadSchema.Type;
