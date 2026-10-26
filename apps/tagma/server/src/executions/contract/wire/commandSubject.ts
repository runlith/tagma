import { Schema } from 'effect';
import { Principal } from '@runlith/executions/protocol/custody';
import { ThreadId } from '../../../platform/contract/wire/thread.js';

export const CommandSubject = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Thread'), thread: ThreadId }),
  Schema.Struct({ _tag: Schema.Literal('Operator') }),
  Schema.Struct({ _tag: Schema.Literal('Service'), scope: Schema.NonEmptyString }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type CommandSubject = typeof CommandSubject.Type;

export type CommandRelation = 'own' | 'ancestor' | 'operator' | 'ungated' | 'other';

export const principalOfSubject = (subject: CommandSubject): Principal => {
  if (subject._tag === 'Thread') return Principal.make(`thread:${subject.thread}`);
  return Principal.make('operator');
};

export const CommandSubjectKey = Schema.NonEmptyString.pipe(Schema.brand('CommandSubjectKey'));
export type CommandSubjectKey = typeof CommandSubjectKey.Type;

export const subjectKeyOf = (subject: CommandSubject): CommandSubjectKey => {
  if (subject._tag === 'Thread') return CommandSubjectKey.make(`thread:${subject.thread}`);
  if (subject._tag === 'Service') return CommandSubjectKey.make(`service:${subject.scope}`);
  return CommandSubjectKey.make('operator');
};

export const subjectOfKey = (key: string): CommandSubject | null => {
  if (key === 'operator') return { _tag: 'Operator' };
  if (key.startsWith('thread:')) {
    const thread = key.slice('thread:'.length);
    return thread === '' ? null : { _tag: 'Thread', thread: ThreadId.make(thread) };
  }
  if (key.startsWith('service:')) {
    const scope = key.slice('service:'.length);
    return scope === '' ? null : { _tag: 'Service', scope };
  }
  return null;
};

export const CommandSubjectSpelling = Schema.String.check(Schema.isPattern(/^(operator|thread:.+|service:.+)$/u)).annotate({
  description: 'One owner, as a row spells it: `thread:<id>`, `operator`, or `service:<scope>`.',
});
