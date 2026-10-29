import { Schema } from 'effect';
import { DomainBlock, DomainPolicy, Restriction, RestrictionState } from '../../../browser/contract/wire/domains.js';
import { HostEvent, LivePage, Navigation, PageChange, Strain } from '../../../browser/contract/wire/host.js';
import { PageId, ProfileId } from '../../../browser/contract/wire/ids.js';
import { History } from '../../../browser/contract/wire/page.js';
import { feed } from '../../../platform/contract/wire/operation.js';

export const DESKTOP = 'desktop';

export const DesktopDocument = Schema.Struct({});

export const REPORT_PATH = '/api/browser/desktop/report';

export const PART_CHARS = 4 * 1024 * 1024;

export const HostId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u));

const at = <const Kind extends string, const Fields extends Schema.Struct.Fields>(kind: Kind, fields: Fields) =>
  Schema.Struct({ kind: Schema.Literal(kind), ...fields });

export const Call = Schema.Union([
  at('open', {
    page: PageId,
    profile: ProfileId,
    context: Schema.NullOr(Schema.String),
    url: Schema.String,
    history: Schema.NullOr(History),
    policy: Schema.NullOr(DomainPolicy),
  }),
  at('adopt', { local: Schema.String, page: PageId }),
  at('close', { page: PageId, ask: Schema.Boolean }),
  at('live', {}),
  at('navigate', { page: PageId, to: Navigation }),
  at('navigation', { page: PageId, watch: Schema.Int, policy: Schema.NullOr(DomainPolicy) }),
  at('unnavigation', { watch: Schema.Int }),
  at('navigationSeen', { watch: Schema.Int }),
  at('pdf', { page: PageId }),
  at('heap', { page: PageId, path: Schema.String }),
  at('answer', { page: PageId, accept: Schema.Boolean, text: Schema.NullOr(Schema.String) }),
  at('paint', { page: PageId, hold: Schema.Int }),
  at('unpaint', { hold: Schema.Int }),
  at('strain', { page: PageId, hold: Schema.Int, strain: Strain }),
  at('unstrain', { hold: Schema.Int }),
  at('geolocation', { page: PageId, hold: Schema.Int }),
  at('unlocate', { hold: Schema.Int }),
  at('session', { page: PageId, session: Schema.Int }),
  at('profileSession', { profile: ProfileId, session: Schema.Int }),
  at('unsession', { session: Schema.Int }),
  at('prepare', { profile: ProfileId }),
  at('remove', { profile: ProfileId }),
  at('key', { service: Schema.String, account: Schema.String }),
]);
export type Call = typeof Call.Type;

export const Order = Schema.Union([
  at('attached', { generation: Schema.Int }),
  at('call', { id: Schema.Int, call: Call }),
  at('cdp', { session: Schema.Int, text: Schema.String }),
]);
export type Order = typeof Order.Type;

export const ATTACH_FEED = feed('attach_browser_host', {
  input: Schema.Struct({ host: HostId, pid: Schema.Int.check(Schema.isGreaterThan(0)) }),
  event: Order,
  refusals: ['device-refused', 'channel-broken'],
  callers: 'operator',
  local: true,
});

export const Failure = Schema.Union([
  at('missing', { message: Schema.String }),
  at('refused', { message: Schema.String, unblock: Schema.NonEmptyArray(Schema.String) }),
  at('navigation', { code: Schema.String, message: Schema.String }),
  at('blocked', { block: DomainBlock, message: Schema.String }),
  at('taken', { message: Schema.String }),
  at('stayed', { message: Schema.String }),
]);
export type Failure = typeof Failure.Type;

export const SESSION_ENDS = ['detached', 'taken', 'closed'] as const;

const seq = Schema.Int.check(Schema.isGreaterThan(0));

export const Report = Schema.Union([
  at('answer', { seq, id: Schema.Int, value: Schema.Unknown }),
  at('bytes', { seq, id: Schema.Int }),
  at('failure', { seq, id: Schema.Int, failure: Failure }),
  at('event', { seq, event: HostEvent }),
  at('blocked', { seq, watch: Schema.Int, block: DomainBlock }),
  at('cdp', { seq, session: Schema.Int }),
  at('ended', { seq, session: Schema.Int, end: Schema.Literals(SESSION_ENDS) }),
]);
export type Report = typeof Report.Type;

export const Parts = Schema.Struct({ parts: Schema.Int.check(Schema.isGreaterThan(1)) });

export const ANSWERS = {
  open: RestrictionState,
  adopt: RestrictionState,
  live: Schema.Array(LivePage),
  navigate: PageChange,
  navigation: Schema.Struct({ blocked: Schema.NullOr(DomainBlock), changes: Schema.Array(Restriction) }),
  key: Schema.String,
} as const;

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

export const framed = (report: Report, tail?: string): readonly string[] => {
  const text = tail === undefined ? JSON.stringify(report) : `${JSON.stringify(report)}\n${tail}`;
  if (text.length <= PART_CHARS) return [text];
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    const cut = Math.min(text.length, start + PART_CHARS);
    const end = cut < text.length && isHighSurrogate(text.charCodeAt(cut - 1)) ? cut - 1 : cut;
    parts.push(text.slice(start, end));
    start = end;
  }
  return [JSON.stringify({ parts: parts.length }), ...parts];
};

export const split = (text: string): { readonly head: string; readonly tail: string | undefined } => {
  const end = text.indexOf('\n');
  return end < 0 ? { head: text, tail: undefined } : { head: text.slice(0, end), tail: text.slice(end + 1) };
};
