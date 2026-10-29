import * as Schema from 'effect/Schema';
import type { HeapReadOptions } from '../HeapReader.js';
import { heapReportSchema, heapSummarySchema } from '../HeapSummary.ts';

export type HeapJob = { readonly file: string; readonly options?: HeapReadOptions };

export const heapAnswerSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal('read'), summary: heapSummarySchema }),
  Schema.Struct({ status: Schema.Literal('report'), report: heapReportSchema }),
  Schema.Struct({ status: Schema.Literal('failed'), message: Schema.String }),
]);
export type HeapAnswer = typeof heapAnswerSchema.Type;
