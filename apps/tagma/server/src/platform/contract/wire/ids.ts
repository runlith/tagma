import { Schema } from 'effect';
import type { ActorRef } from './actor.js';

export const OperationId = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand('OperationId'));
export type OperationId = typeof OperationId.Type;

export const RequestKey = Schema.NonEmptyString.pipe(Schema.brand('RequestKey'));
export type RequestKey = typeof RequestKey.Type;

export type CallKey = {
  readonly actorRef: ActorRef;
  readonly operation: OperationId;
  readonly key: string;
};

export const SPOKEN_LENGTH = 8;

export function spokenId(id: string): string {
  return id.replaceAll('-', '').slice(-SPOKEN_LENGTH);
}
