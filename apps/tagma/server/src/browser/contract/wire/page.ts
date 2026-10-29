import { Schema } from 'effect';
import { PageId, ProfileId } from './ids.js';
import { Conditions } from './emulation.js';

export const PAGE_STATES = ['live', 'dormant', 'away'] as const;
export type PageState = (typeof PAGE_STATES)[number];

export const DIALOG_KINDS = ['alert', 'confirm', 'prompt', 'beforeunload'] as const;

export const Dialog = Schema.Struct({
  kind: Schema.Literals(DIALOG_KINDS),
  message: Schema.String,
  prompt: Schema.NullOr(Schema.String),
  url: Schema.String,
});
export type Dialog = typeof Dialog.Type;

export const DOWNLOAD_STATES = ['running', 'done', 'failed', 'cancelled'] as const;

export const Download = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.NullOr(Schema.String),
  bytes: Schema.NullOr(Schema.Number),
  state: Schema.Literals(DOWNLOAD_STATES),
  at: Schema.String,
});
export type Download = typeof Download.Type;

export const HistoryEntry = Schema.Struct({ url: Schema.String, title: Schema.String });
export type HistoryEntry = typeof HistoryEntry.Type;

export const History = Schema.Struct({ entries: Schema.Array(HistoryEntry), at: Schema.Int });
export type History = typeof History.Type;

export const Live = Schema.Struct({
  loading: Schema.Boolean,
  back: Schema.Boolean,
  forward: Schema.Boolean,
  crashed: Schema.Boolean,
  responsive: Schema.Boolean,
  dialog: Schema.NullOr(Dialog),
  driven: Schema.NullOr(Schema.String),
  shown: Schema.Boolean,
  conditions: Conditions,
});
export type Live = typeof Live.Type;

export const Page = Schema.Struct({
  id: PageId,
  projectId: Schema.Int,
  profile: ProfileId,
  url: Schema.String,
  title: Schema.String,
  favicon: Schema.NullOr(Schema.String),
  openedBy: Schema.NullOr(Schema.String),
  opener: Schema.NullOr(PageId),
  state: Schema.Literals(PAGE_STATES),
  host: Schema.NullOr(Schema.String).annotate({ description: 'The id of the connected host that holds the page now.' }),
  live: Live,
  downloads: Schema.Int.annotate({ description: 'How many downloads the page keeps; read_page_downloads lists them.' }),
  activeAt: Schema.String,
  closedAt: Schema.NullOr(Schema.String),
});
export type Page = typeof Page.Type;

export const Glance = Schema.Struct({
  id: PageId,
  url: Schema.String,
  title: Schema.String,
  loading: Schema.Boolean,
  dialog: Schema.NullOr(Dialog),
  navigated: Schema.Boolean,
  conditions: Schema.NullOr(Schema.String),
});
export type Glance = typeof Glance.Type;

export const PagesEvent = Schema.Union([
  Schema.Struct({ type: Schema.tag('list'), pages: Schema.Array(Page) }),
  Schema.Struct({ type: Schema.tag('put'), page: Page }),
  Schema.Struct({ type: Schema.tag('gone'), id: PageId }),
]).pipe(Schema.toTaggedUnion('type'));
export type PagesEvent = typeof PagesEvent.Type;
