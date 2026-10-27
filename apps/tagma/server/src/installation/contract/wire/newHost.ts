import { Schema } from 'effect';

export const hostEndingSchema = Schema.Struct({
  execution: Schema.String,
  incarnation: Schema.Int,
  activity: Schema.Literals(['program', 'shell', 'command', 'unread']).annotate({
    description:
      'program: a terminal with a program in its foreground; shell: a terminal whose login shell waits at its prompt; command: a command a thread or the operator ran, or a pipes execution this server holds no record of; unread: a terminal whose foreground could not be read, or a pty execution this server holds no record of.',
  }),
  title: Schema.String.annotate({ description: 'What runs: the foreground program of a terminal, else its label or command line.' }),
  projectId: Schema.NullOr(Schema.Int),
  thread: Schema.NullOr(Schema.String),
});
export type HostEnding = typeof hostEndingSchema.Type;

export const newHostSchema = Schema.Struct({
  cause: Schema.Literals(['update', 'standing']).annotate({
    description:
      'update: the installation ready beside this server needs a new execution host; standing: this server runs beside the host of another build, which does not take it.',
  }),
  build: Schema.NullOr(Schema.String).annotate({ description: 'The build that needs the new host.' }),
  host: Schema.NullOr(Schema.String).annotate({ description: 'The build of the host in place.' }),
  detail: Schema.String,
  ends: Schema.NullOr(Schema.Array(hostEndingSchema)).annotate({
    description: 'Everything a new host ends; null when the host in place could not say.',
  }),
  back: Schema.NullOr(Schema.String).annotate({
    description: 'standing: the id of the offer that opens the installation kept beside, whose build the host may take.',
  }),
});
export type NewHost = typeof newHostSchema.Type;
