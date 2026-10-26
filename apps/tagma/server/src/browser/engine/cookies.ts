import { type Cookie, keyOf, type Reading, siteOf } from '@runlith/browser-cookies/cookie';
import type { Plan } from '@runlith/browser-cookies/policy';
import type { CommandFailure, Params, Result, Session } from '@runlith/cdp/session';
import { Effect } from 'effect';

type Param = Params<'Network.setCookies'>['cookies'][number];
type Stored = Result<'Network.getAllCookies'>['cookies'][number];

const CHUNK = 200;
const DELETING = 16;

export type Written = { readonly written: number; readonly rejected: number };

export const paramOf = (cookie: Cookie): Param => ({
  name: cookie.name,
  value: cookie.value,
  domain: cookie.domain,
  path: cookie.path,
  secure: cookie.secure,
  httpOnly: cookie.httpOnly,
  sameSite: cookie.sameSite ?? undefined,
  expires: cookie.expires ?? undefined,
  priority: cookie.priority ?? undefined,
  sourceScheme: cookie.scheme ?? undefined,
  sourcePort: cookie.port ?? undefined,
  partitionKey: cookie.partitionKey ?? undefined,
});

const cookieOf = (stored: Stored): Cookie | null => {
  const site = stored.partitionKey === undefined ? null : siteOf(stored.partitionKey.topLevelSite);
  if (stored.partitionKeyOpaque === true || (stored.partitionKey !== undefined && site === null)) return null;
  return {
    name: stored.name,
    value: stored.value,
    domain: stored.domain,
    path: stored.path,
    expires: stored.session || stored.expires < 0 ? null : stored.expires,
    secure: stored.secure,
    httpOnly: stored.httpOnly,
    sameSite: stored.sameSite ?? null,
    partitionKey:
      stored.partitionKey === undefined || site === null
        ? null
        : { topLevelSite: site, hasCrossSiteAncestor: stored.partitionKey.hasCrossSiteAncestor },
    priority: stored.priority,
    scheme: stored.sourceScheme,
    port: stored.sourcePort < 0 ? null : stored.sourcePort,
  };
};

export const storedCookies = Effect.fn('cookies.stored')(function* (session: Session) {
  const { cookies } = yield* session.send('Network.getAllCookies');
  const read: Cookie[] = [];
  let unreadable = 0;
  for (const stored of cookies) {
    const cookie = cookieOf(stored);
    if (cookie === null) unreadable += 1;
    else read.push(cookie);
  }
  return { cookies: read, unreadable } satisfies Reading;
});

const removed = (session: Session, cookies: readonly Cookie[]) =>
  Effect.forEach(
    cookies,
    (cookie) =>
      session.send('Network.deleteCookies', {
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        partitionKey: cookie.partitionKey ?? undefined,
      }),
    { concurrency: DELETING, discard: true },
  );

const placed = (session: Session, cookies: readonly Cookie[]): Effect.Effect<void, CommandFailure> =>
  session.send('Network.setCookies', { cookies: cookies.map(paramOf) }).pipe(
    Effect.asVoid,
    Effect.catchTag('CommandRefused', (refused) => {
      if (cookies.length === 1)
        return Effect.logDebug(
          `browser: the profile store refused cookie ${cookies[0]!.name} of ${cookies[0]!.domain}: ${refused.message}`,
        );
      const half = Math.ceil(cookies.length / 2);
      return Effect.andThen(placed(session, cookies.slice(0, half)), placed(session, cookies.slice(half)));
    }),
  );

export const replaced = Effect.fn('cookies.replace')(function* (session: Session, plan: Plan, standing: readonly Cookie[]) {
  yield* removed(session, standing);
  for (let at = 0; at < plan.cookies.length; at += CHUNK) yield* placed(session, plan.cookies.slice(at, at + CHUNK));
  const kept = new Set((yield* storedCookies(session)).cookies.map(keyOf));
  const written = plan.cookies.filter((cookie) => kept.has(keyOf(cookie))).length;
  return { written, rejected: plan.cookies.length - written } satisfies Written;
});

export const restored = Effect.fn('cookies.restore')(function* (session: Session, plan: Plan, snapshot: readonly Cookie[]) {
  const now = yield* storedCookies(session);
  yield* removed(
    session,
    now.cookies.filter((cookie) => plan.covers(cookie.domain)),
  );
  for (let at = 0; at < snapshot.length; at += CHUNK) yield* placed(session, snapshot.slice(at, at + CHUNK));
});
