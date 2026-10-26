import { Schema } from 'effect';
import { PageId, ProfileId } from './ids.js';
import { Dialog, Download, History } from './page.js';

export const Navigation = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('url'), url: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('back') }),
  Schema.Struct({ kind: Schema.Literal('forward') }),
  Schema.Struct({ kind: Schema.Literal('reload') }),
  Schema.Struct({ kind: Schema.Literal('stop') }),
]);
export type Navigation = typeof Navigation.Type;

export const LivePage = Schema.Struct({
  page: Schema.NullOr(PageId),
  local: Schema.String,
  profile: ProfileId,
  url: Schema.String,
  title: Schema.String,
  opener: Schema.NullOr(PageId),
});
export type LivePage = typeof LivePage.Type;

export const PageChange = Schema.Struct({
  url: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  favicon: Schema.optionalKey(Schema.NullOr(Schema.String)),
  loading: Schema.optionalKey(Schema.Boolean),
  back: Schema.optionalKey(Schema.Boolean),
  forward: Schema.optionalKey(Schema.Boolean),
  history: Schema.optionalKey(History),
});
export type PageChange = typeof PageChange.Type;

const pageSignal = <const Kind extends string>(kind: Kind) => Schema.Struct({ kind: Schema.Literal(kind), page: PageId });

export const HostEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('opened'),
    local: Schema.String,
    profile: ProfileId,
    opener: Schema.NullOr(PageId),
    url: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal('changed'), page: PageId, change: PageChange }),
  pageSignal('swapped'),
  pageSignal('unresponsive'),
  pageSignal('responsive'),
  pageSignal('crashed'),
  pageSignal('closed'),
  pageSignal('dropped'),
  Schema.Struct({ kind: Schema.Literal('dialog'), page: PageId, dialog: Schema.NullOr(Dialog) }),
  Schema.Struct({ kind: Schema.Literal('download'), page: PageId, download: Download }),
  pageSignal('released'),
]);
export type HostEvent = typeof HostEvent.Type;
