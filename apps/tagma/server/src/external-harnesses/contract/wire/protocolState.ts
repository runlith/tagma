import { Schema } from 'effect';

const offset = Schema.String.annotate({ description: 'A byte offset of the runner stdout record, as a canonical decimal string.' });

export const PROTOCOL_STATE = {
  threadId: Schema.String,
  session: Schema.NullOr(
    Schema.Struct({
      state: Schema.Literals(['starting', 'running', 'stopping', 'uncertain', 'ended']),
      owner: Schema.Literals(['this server', 'another server', 'nobody']),
      startedAt: Schema.String,
    }),
  ).annotate({ description: 'The agent session, null before the thread ever started one.' }),
  driven: Schema.Boolean.annotate({ description: 'A driver of this server reads the runner output now.' }),
  driverFailure: Schema.NullOr(Schema.Struct({ failure: Schema.String, at: Schema.String })).annotate({
    description: 'The last failure that ended a driver of this thread on this server since the session started.',
  }),
  execution: Schema.NullOr(
    Schema.Struct({ execution: Schema.String, incarnation: Schema.Number, held: Schema.Boolean }).annotate({
      description: 'The runner process; `held` says whether this installation still holds its record.',
    }),
  ),
  phase: Schema.NullOr(Schema.Literals(['handshake', 'opening', 'ready'])),
  stdout: Schema.NullOr(
    Schema.Struct({
      parsed: offset.annotate({ description: 'Where the driver resumes reading the runner output.' }),
      written: Schema.NullOr(offset).annotate({ description: 'How far the runner wrote its output; null when `unread` says why not.' }),
      unread: Schema.NullOr(Schema.String),
      torn: Schema.Boolean,
    }),
  ),
  requests: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      method: Schema.String,
      turn: Schema.NullOr(Schema.String),
      admitted: Schema.Boolean,
      uncertain: Schema.Boolean,
      sentAt: Schema.NullOr(Schema.String),
      ageMs: Schema.NullOr(Schema.Number),
    }),
  ).annotate({ description: 'Requests Tagma sent the agent that it has not answered, oldest first.' }),
  asks: Schema.Array(
    Schema.Struct({ id: Schema.String, method: Schema.String, turn: Schema.NullOr(Schema.String), uncertain: Schema.Boolean }),
  ).annotate({ description: 'Requests the agent sent that Tagma has not answered.' }),
  turns: Schema.Array(Schema.Struct({ runId: Schema.String, startedAt: Schema.String })),
  failure: Schema.NullOr(Schema.String).annotate({ description: 'The failure the protocol row holds, which ends its process.' }),
};

export const ProtocolState = Schema.Struct(PROTOCOL_STATE);
export type ProtocolState = typeof ProtocolState.Type;
