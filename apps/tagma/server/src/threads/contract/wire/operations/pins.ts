import { Schema } from 'effect';
import { threadInput } from '../project.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';
import { pinnedViewSchema } from '../pins.js';

const shape = {
  approval: ASKS_NEVER,
  doors: { http: 'perform' },
  tool: undefined,
  callers: 'operator',
  external: true,
  effect: 'write',
  identity: { key: 'call' },
  place: 'project',
  graph: 'none',
  subject: 'none',
  waits: [],
  lifetimes: [],
  subjects: () => [],
  input: Schema.Struct({ threadId: ThreadId, ...pinnedViewSchema.fields }),
  refusals: ['not-found', 'foreign-project'],
} as const;

export const PIN_OPERATIONS = {
  pin_view: operation('pin_view', {
    ...shape,
    meaning:
      'Pin an app view and its resource key above the thread feed; the view must be named in the app’s contributes.pins. Repeating the same address keeps one pin.',
    refusals: [...shape.refusals, 'view-not-pinnable'],
    answer: arms({ pinned: { threadId: ThreadId, ...pinnedViewSchema.fields } }),
    confirmation: () => ({ summary: 'Pin this view?' }),
    confirmLabel: 'Pin',
    presentation: { running: 'Pinning view', done: 'Pinned view' },
  }),
  unpin_view: operation('unpin_view', {
    ...shape,
    meaning: 'Remove an app view and its resource key from the thread pins. Repeating removal leaves it removed.',
    answer: arms({ unpinned: { threadId: ThreadId, ...pinnedViewSchema.fields } }),
    confirmation: () => ({ summary: 'Unpin this view?' }),
    confirmLabel: 'Unpin',
    presentation: { running: 'Unpinning view', done: 'Unpinned view' },
  }),
} as const;

export type PinOperationId = keyof typeof PIN_OPERATIONS;
