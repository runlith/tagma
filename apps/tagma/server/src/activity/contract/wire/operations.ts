import { PAGE_CURSOR } from '@runlith/paging';
import { Schema } from 'effect';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { FAULT_ROWS, FaultsPage } from './faults.js';

const machine = {
  approval: ASKS_NEVER,
  doors: { http: 'perform' },
  subject: 'none',
  place: 'machine',
  waits: [],
  lifetimes: [],
  subjects: () => [],
} as const;

export const ACTIVITY_OPERATIONS = {
  read_faults: operation('read_faults', {
    ...machine,
    tool: { capability: 'graph' },
    callers: 'any',
    effect: 'read',
    identity: 'none',
    page: FAULT_ROWS,
    meaning:
      "Read the defects of this Tagma server the operator's Errors list shows: each failure that stopped the work it was in (`defect`) and each one a run survived with a fallback (`degraded`), grouped by place and message, newest first.",
    grammar:
      'A row carries how many times it happened, its first and last moment in ms, and the stack, activity, thread, run and project of its latest occurrence. Rows reach back over the activity window or to the moment the operator last cleared the list, whichever is later; `since` names that moment. `lost` names facts the activity store could not keep inside it: a defect among them is missing from the rows. `total` counts every group in that reach; `next` continues to older groups and is null on the last page.',
    input: Schema.Struct({ limit: limitOf(FAULT_ROWS), cursor: PAGE_CURSOR }),
    answer: arms({ ok: { ...FaultsPage.fields, next: Schema.NullOr(Schema.String) } }),
    refusals: ['activity-unreadable', 'bad-cursor', 'cursor-stale'],
    confirmation: () => ({ summary: 'Read the defects of this server?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading server defects', done: 'Read server defects' },
  }),
  clear_faults: operation('clear_faults', {
    ...machine,
    callers: 'operator',
    effect: 'write',
    identity: { key: 'call' },
    meaning: 'Clear the Errors list of every window: the defects up to now leave it, and one that happens again comes back as a new row.',
    input: Schema.Struct({}),
    answer: arms({ cleared: {} }),
    refusals: ['activity-unreadable'],
    confirmation: () => ({ summary: 'Clear the Errors list?' }),
    confirmLabel: 'Clear',
    presentation: { running: 'Clearing the Errors list', done: 'Cleared the Errors list' },
  }),
};

export type ActivityOperationId = keyof typeof ACTIVITY_OPERATIONS;
