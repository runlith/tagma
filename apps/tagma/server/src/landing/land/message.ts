import type { HeldTaskLabel } from '../../change-record/contract/service/taskLabels.js';
import { AGENT_PERSON, personOf, type Trailer, trailed } from '../../platform/contract/wire/commits.js';

export const CO_AUTHOR: Trailer = ['Co-authored-by', personOf(AGENT_PERSON)];

const team = (tasks: readonly HeldTaskLabel[]): readonly HeldTaskLabel[] => tasks.filter((task) => !task.stealth);

export const subjectFor = (subject: string | undefined, tasks: readonly HeldTaskLabel[]): string => {
  if (subject !== undefined && subject.trim() !== '') return subject;
  const named = team(tasks);
  const only = named[0];
  return named.length === 1 && tasks.length === 1 && only !== undefined ? only.title : 'the changes of one session';
};

export const messageOf = (subject: string, body: string | undefined, tasks: readonly HeldTaskLabel[], coAuthored: boolean): string => {
  const said = body === undefined || body.trim() === '' ? subject : `${subject.trimEnd()}\n\n${body.trim()}`;
  const named = new Map(team(tasks).map((task) => [task.name, task]));
  const carried = [...named.values()].map((task): Trailer => ['Task', `${task.name} ${task.title}`]);
  return trailed(said, coAuthored ? [...carried, CO_AUTHOR] : carried);
};
