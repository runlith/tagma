import { HttpApiMiddleware } from 'effect/http-api';
import { refusalSchema, type RefusalBody } from '../../../platform/contract/wire/refusal.js';

export const SHAPE_REFUSAL_UNBLOCK = ['the reason names the field: send that one in the shape it asks for'] as const;

export const shapeRefusal = (code: string, reason: string): RefusalBody => ({
  code,
  reason,
  unblock: SHAPE_REFUSAL_UNBLOCK,
});

export class SchemaRefusal extends HttpApiMiddleware.Service<SchemaRefusal>()('tagma/http/SchemaRefusal', {
  error: refusalSchema,
}) {}
