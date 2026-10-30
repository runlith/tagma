import type { GraphEventOp } from '@tagma/server/graph/contract/wire/journal';

const OP_WORDS: Readonly<Record<GraphEventOp, string>> = {
  project_add: 'project added',
  project_set_root: 'root changed',
  project_set: 'project edited',
  project_set_storage: 'storage changed',
  project_remove: 'project removed',
  project_return: 'project returned',
  create: 'created',
  update: 'edited',
  claim: 'claimed',
  release: 'released',
  done: 'finished',
  close: 'closed',
  link: 'linked',
  unlink: 'unlinked',
  anchor: 'anchored',
  unanchor: 'unanchored',
  relocate: 'moved',
  supersede: 'superseded',
  unsupersede: 'supersession withdrawn',
  settle: 'settled',
  delete: 'deleted',
  depart: 'moved',
  restore: 'restored',
  enable: 'enabled',
  disable: 'disabled',
  enforce: 'rule enforced',
  remeasure: 'remeasured',
  answer: 'answered',
  unanswer: 'answer withdrawn',
};

const words: Readonly<Record<string, string>> = OP_WORDS;

export const opWord = (op: string): string => words[op] ?? op;

export const opWords = (ops: readonly string[]): string => ops.map(opWord).join(', ');
