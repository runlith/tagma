import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { gitAnswer, OwnGitFailed } from '../../platform/git/ownGit.js';
import { trailed } from '../../platform/contract/wire/commits.js';
import { CHECKOUT_DIRECTORY } from '../contract/wire/storage.js';
import type { ActEntry, BlockRow } from '../contract/service/acts.js';
import type { GraphEventOp } from '../contract/wire/journal.js';
import { blockName } from '../contract/wire/references.js';
import type { TagReading } from '../contract/wire/tags/reading.js';
import { LIFECYCLE } from '../contract/wire/tags/lifecycle.js';
import { SPEC } from '../contract/wire/tags/spec.js';
import { WORK } from '../contract/wire/tags/work.js';
import { LAW } from '../contract/wire/tags/lawContracts.js';

const SUBJECT_LIMIT = 72;
const CONVENTION_SAMPLE = 10;
const NO_HISTORY = /does not have any commits yet|not a git repository/u;
const CONVENTIONAL = /^[a-z]+(\([^()]+\))?!?: \S/u;
const PREFIX = 'docs(graph): ';
const POSITION_TRAILER = 'Tagma-Graph';
const UNTAGGED = 'note';
const PROJECT = 'project';

export type CommitShape = 'conventional' | 'plain';

export type ActLine = {
  readonly verb: string;
  readonly name: string | null;
  readonly title: string;
  readonly kind: string;
  readonly weight: number;
};

export type CommitAct = {
  readonly lines: readonly ActLine[];
  readonly agent: string | null;
  readonly position: number | null;
};

export type NamedBlock = Pick<BlockRow, 'uuid' | 'title' | 'tags'>;

const VERBS: Record<Exclude<GraphEventOp, 'create'>, string> = {
  project_add: 'add',
  project_set_root: 'move',
  project_set: 'set',
  project_set_storage: 'move storage of',
  project_remove: 'remove',
  project_return: 'return',
  update: 'edit',
  claim: 'claim',
  release: 'release',
  done: 'finish',
  close: 'close',
  link: 'link',
  unlink: 'unlink',
  anchor: 'anchor',
  unanchor: 'unanchor',
  relocate: 'move',
  supersede: 'supersede',
  unsupersede: 'unsupersede',
  settle: 'settle',
  delete: 'delete',
  restore: 'restore',
  enable: 'enable',
  disable: 'disable',
  enforce: 'enforce',
  remeasure: 'remeasure',
  accept: 'accept',
  reject: 'reject',
  uphold: 'uphold',
  revise: 'revise',
  answer: 'answer',
  unanswer: 'unanswer',
};

const weightOf = (op: GraphEventOp, node: NamedBlock, table: TagReading): number =>
  table.supports(node, SPEC) && (op === 'create' || op === 'close')
    ? 0
    : table.supports(node, WORK) && (op === 'create' || op === 'done')
      ? 1
      : table.supports(node, LAW) && op === 'create'
        ? 2
        : 3;

export const actLines = (entries: readonly ActEntry[], blocks: ReadonlyMap<number, NamedBlock>, table: TagReading): ActLine[] =>
  entries.flatMap((entry): ActLine[] => {
    if (entry.blockId === null) {
      if (entry.op === 'create') return [];
      return [{ verb: VERBS[entry.op], name: null, title: '', kind: PROJECT, weight: 3 }];
    }
    const node = blocks.get(entry.blockId);
    if (node === undefined) return [];
    return [
      {
        verb: entry.op === 'create' ? (table.supports(node, LIFECYCLE) ? 'open' : 'add') : VERBS[entry.op],
        name: blockName(node.uuid),
        title: node.title.replace(/\s+/gu, ' ').trim(),
        kind: node.tags[0] ?? UNTAGGED,
        weight: weightOf(entry.op, node, table),
      },
    ];
  });

const plural = (word: string): string =>
  /(s|x|z|ch|sh)$/u.test(word) ? `${word}es` : /[^aeiou]y$/u.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;

const counted = (lines: readonly ActLine[], room: number): string => {
  const groups = new Map<string, { verb: string; kind: string; weight: number; count: number; order: number }>();
  for (const line of lines) {
    const key = `${line.verb}\0${line.kind}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { verb: line.verb, kind: line.kind, weight: line.weight, count: 1, order: groups.size });
    else {
      group.count += 1;
      group.weight = Math.min(group.weight, line.weight);
    }
  }
  const ranked = [...groups.values()].sort((a, b) => a.weight - b.weight || b.count - a.count || a.order - b.order);
  const phrases = ranked.map((group) =>
    group.count === 1 ? `${group.verb} ${group.kind}` : `${group.verb} ${group.count} ${plural(group.kind)}`,
  );
  let named = 0;
  let best = `${lines.length} graph changes`;
  for (let shown = 1; shown <= phrases.length; shown += 1) {
    named += (ranked[shown - 1] as { count: number }).count;
    const rest = lines.length - named;
    const text = `${phrases.slice(0, shown).join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`;
    if (text.length > room) break;
    best = text;
  }
  return best;
};

const phraseOf = (lines: readonly ActLine[], room: number): string => {
  if (lines.length === 0) return 'sync graph files';
  const top = Math.min(...lines.map((line) => line.weight));
  const leading = lines.filter((line) => line.weight === top);
  const act = leading[0] as ActLine;
  if (leading.length === 1 && act.title !== '') {
    const rest = lines.length - 1;
    const titled = `${act.verb} ${act.kind} "${act.title}"${rest > 0 ? ` and ${rest} more` : ''}`;
    if (titled.length <= room) return titled;
  }
  return counted(lines, room);
};

const lineOf = (line: ActLine): string => [line.verb, line.name ?? line.kind, line.title].filter((part) => part !== '').join(' ');

export class GraphBatch {
  private readonly lines = new Map<string, ActLine>();
  private readonly agents = new Set<string>();
  private reached: number | null = null;

  get position(): number | null {
    return this.reached;
  }

  get acts(): number {
    return this.lines.size;
  }

  get named(): readonly string[] {
    return [...this.agents];
  }

  add(act: CommitAct): void {
    for (const line of act.lines) {
      const key = `${line.verb}\0${line.name ?? line.kind}`;
      if (!this.lines.has(key)) this.lines.set(key, line);
    }
    if (act.agent !== null && act.lines.length > 0) this.agents.add(act.agent);
    if (act.position !== null) this.reached = Math.max(this.reached ?? 0, act.position);
  }

  absorb(later: GraphBatch): void {
    this.add({ lines: [...later.lines.values()], agent: null, position: later.reached });
    for (const agent of later.agents) this.agents.add(agent);
  }

  message(shape: CommitShape, position: number | null): string {
    const lines = [...this.lines.values()];
    const prefix = shape === 'conventional' ? PREFIX : '';
    const phrase = phraseOf(lines, SUBJECT_LIMIT - prefix.length);
    const subject = `${prefix}${shape === 'conventional' ? phrase : `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`}`;
    const body = [...lines.map(lineOf), ...(this.agents.size === 0 ? [] : [`by ${this.named.join(', ')}`])];
    const text = body.length === 0 ? subject : `${subject}\n\n${body.join('\n')}`;
    return `${position === null ? text : trailed(text, [[POSITION_TRAILER, String(position)]])}\n`;
  }
}

export const shapeOf = (git: Git['Service'], checkout: string): Effect.Effect<CommitShape, OwnGitFailed> =>
  Effect.flatMap(
    gitAnswer(git, 'graph-shape', [
      '-C',
      checkout,
      'log',
      `--max-count=${CONVENTION_SAMPLE}`,
      '--no-merges',
      '--format=%s',
      '--',
      ':(top)',
      `:(top,exclude)${CHECKOUT_DIRECTORY}`,
    ]),
    (answer) => {
      if (answer.status !== 0) {
        return NO_HISTORY.test(answer.stderr)
          ? Effect.succeed<CommitShape>('plain')
          : Effect.fail(new OwnGitFailed({ op: 'graph-shape', message: answer.stderr.trim() || answer.stdout.trim(), ran: true }));
      }
      const subjects = answer.stdout.split('\n').filter((subject) => subject !== '');
      return Effect.succeed<CommitShape>(
        subjects.filter((subject) => CONVENTIONAL.test(subject)).length * 2 > subjects.length ? 'conventional' : 'plain',
      );
    },
  );
