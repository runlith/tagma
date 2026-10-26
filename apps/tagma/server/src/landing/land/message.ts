import type { HeldTaskLabel } from '../../change-record/contract/service/taskLabels.js';
import { spokenId } from '../../platform/contract/wire/ids.js';

export const subjectFor = (subject: string | undefined, tasks: readonly HeldTaskLabel[]): string => {
  if (subject !== undefined && subject !== '') return subject;
  const only = tasks[0];
  return tasks.length === 1 && only !== undefined ? only.title : 'the changes of one session';
};

export const messageOf = (subject: string, tasks: readonly HeldTaskLabel[]): string => {
  if (tasks.length === 0) return subject;
  const newline = subject.search(/\r?\n/);
  const end = newline === -1 ? subject.length : newline;
  const headline = subject.slice(0, end);
  const suffix = headline.match(/(?:[ \t]+\([0-9a-f]{8,32}(?:,[ \t]*[0-9a-f]{8,32})*\))+[ \t]*$/iu);
  const names = new Map<string, string>();
  for (const name of suffix?.[0].match(/[0-9a-f]{8,32}/giu) ?? []) names.set(spokenId(name.toLowerCase()), name);
  for (const task of tasks) names.set(spokenId(task.name.toLowerCase()), task.name);
  return `${headline.slice(0, suffix?.index ?? headline.length)} (${[...names.values()].join(', ')})${subject.slice(end)}`;
};
