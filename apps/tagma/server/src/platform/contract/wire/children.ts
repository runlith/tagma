import * as Schema from 'effect/Schema';
import { ThreadId } from './thread.js';

export const ChildRole = Schema.Literals(['database', 'git']);
export type ChildRole = typeof ChildRole.Type;

export const ChildAttribution = Schema.Struct({
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  role: ChildRole,
  thread: Schema.optional(ThreadId),
});
export type ChildAttribution = typeof ChildAttribution.Type;
