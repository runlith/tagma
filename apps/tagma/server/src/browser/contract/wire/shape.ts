import { Schema } from 'effect';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { projectField } from '../../../platform/contract/wire/place.js';
import { PageId } from './ids.js';

export const BROWSER_TOOL = { capability: 'browser' } as const;

const machine = {
  approval: ASKS_NEVER,
  doors: { http: 'perform' },
  tool: BROWSER_TOOL,
  callers: 'any',
  external: true,
  subject: 'none',
  waits: [],
  lifetimes: [],
  subjects: () => [],
} as const;

export const MACHINE_READING = { ...machine, place: 'machine', effect: 'read', identity: 'none' } as const;

export const MACHINE_ACTING = { ...machine, place: 'machine', effect: 'external', identity: { key: 'call' } } as const;

export const READING = { ...MACHINE_READING, place: 'project' } as const;

export const ACTING = { ...MACHINE_ACTING, place: 'project' } as const;

export const project = projectField;

export const page = Schema.optional(PageId).annotate({
  description: 'The page id open_page or list_pages answered; omitted, the page this thread worked with last.',
});

export const PAGE_REFUSALS = ['page-unknown', 'host-away', 'profile-unknown', 'host-refused', 'outcome-unknown'] as const;

export const DRIVE_REFUSALS = [
  ...PAGE_REFUSALS,
  'page-unresponsive',
  'page-crashed',
  'devtools-open',
  'dialog-open',
  'action-failed',
] as const;
