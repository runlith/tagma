import { Schema } from 'effect';
import { type Cookie, hostOf, type Reading, type SameSite, siteOf } from '../cookie.js';

const Entry = Schema.Struct({
  domain: Schema.String.check(Schema.isMinLength(1)),
  hostOnly: Schema.optional(Schema.Boolean),
  name: Schema.String,
  value: Schema.String,
  path: Schema.optional(Schema.String),
  secure: Schema.optional(Schema.Boolean),
  httpOnly: Schema.optional(Schema.Boolean),
  sameSite: Schema.optional(Schema.String),
  session: Schema.optional(Schema.Boolean),
  expirationDate: Schema.optional(Schema.Finite),
  expires: Schema.optional(Schema.Finite),
  partitionKey: Schema.optional(Schema.Struct({ topLevelSite: Schema.String, hasCrossSiteAncestor: Schema.Boolean })),
});
type Entry = typeof Entry.Type;

const isEntry = Schema.is(Entry);

const SAME_SITE: Readonly<Record<string, SameSite>> = {
  no_restriction: 'None',
  none: 'None',
  lax: 'Lax',
  strict: 'Strict',
};

const cookieOf = (entry: Entry): Cookie | null => {
  const partitionKey = entry.partitionKey === undefined ? null : siteOf(entry.partitionKey.topLevelSite);
  if (entry.partitionKey !== undefined && partitionKey === null) return null;
  const expiry = entry.session === true ? undefined : (entry.expirationDate ?? entry.expires);
  return {
    name: entry.name,
    value: entry.value,
    domain: entry.hostOnly === true ? hostOf(entry.domain) : entry.domain,
    path: entry.path || '/',
    expires: expiry === undefined || expiry <= 0 ? null : expiry,
    secure: entry.secure === true,
    httpOnly: entry.httpOnly === true,
    sameSite: entry.sameSite === undefined ? null : (SAME_SITE[entry.sameSite.toLowerCase()] ?? null),
    partitionKey:
      partitionKey === null || entry.partitionKey === undefined
        ? null
        : { topLevelSite: partitionKey, hasCrossSiteAncestor: entry.partitionKey.hasCrossSiteAncestor },
    priority: null,
    scheme: null,
    port: null,
  };
};

export const readCookieText = (text: string): Reading => {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('the file holds no JSON array of cookies');
  const cookies: Cookie[] = [];
  let unreadable = 0;
  for (const raw of parsed) {
    const cookie = isEntry(raw) ? cookieOf(raw) : null;
    if (cookie === null) unreadable += 1;
    else cookies.push(cookie);
  }
  return { cookies, unreadable };
};
