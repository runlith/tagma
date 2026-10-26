import { Schema } from 'effect';
import { HttpApiMiddleware } from 'effect/http-api';
import { refusalSchema } from '../../../platform/contract/wire/refusal.js';
import type { CallServices } from '../../../invocation/contract/service/admission.js';

export class CallerMiddleware extends HttpApiMiddleware.Service<CallerMiddleware, { provides: CallServices }>()(
  'tagma/http/CallerMiddleware',
  { error: refusalSchema },
) {}

export class OperationCaller extends HttpApiMiddleware.Service<OperationCaller, { provides: CallServices }>()(
  'tagma/http/OperationCaller',
  {
    error: refusalSchema,
  },
) {}

const checkoutQueryFields = { cwd: Schema.optional(Schema.String) };
export interface CheckoutQuery extends Schema.Struct<typeof checkoutQueryFields> {}
export const checkoutQuery: CheckoutQuery = Schema.Struct(checkoutQueryFields);

const graphQueryFields = {
  ...checkoutQueryFields,
  project: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
};
export interface GraphQuery extends Schema.Struct<typeof graphQueryFields> {}
export const graphQuery: GraphQuery = Schema.Struct(graphQueryFields);

const lensQueryFields = { ...graphQueryFields, scope: Schema.optional(Schema.String) };
export interface LensQuery extends Schema.Struct<typeof lensQueryFields> {}
export const lensQuery: LensQuery = Schema.Struct(lensQueryFields);
