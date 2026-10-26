import { isAbsolute } from 'node:path';
import type { Cookie, Reading } from '@runlith/browser-cookies/cookie';
import { readCookieFile } from '@runlith/browser-cookies/file';
import { type Plan, planImport } from '@runlith/browser-cookies/policy';
import type { KeyUnavailable, ProfileMissing, SourceUnreadable } from '@runlith/browser-cookies/source';
import { type CommandFailure, isCommandFailure, type Session } from '@runlith/cdp/session';
import { Clock, Effect } from 'effect';
import type { Caller } from '../platform/contract/wire/caller.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { CookieSources } from './contract/service/cookies.js';
import { type HostFailure, HostAdapters, Hosts, type ProfileRecord } from './contract/service/hosts.js';
import { outcomeUnknown } from './contract/service/pages.js';
import { Profiles } from './contract/service/profiles.js';
import type { ProfileId } from './contract/wire/ids.js';
import { replaced, restored, storedCookies } from './engine/cookies.js';

export type Origin =
  | { readonly kind: 'browser'; readonly browser: string; readonly profile: string | undefined }
  | { readonly kind: 'tagma'; readonly profile: ProfileId }
  | { readonly kind: 'file'; readonly file: string };

export type Imported = {
  readonly written: number;
  readonly google: number;
  readonly unreadable: number;
  readonly rejected: number;
  readonly domains: readonly string[];
};

const shape = (reason: string) => new GateRefusal('action-shape', reason, ['send the fields import_cookies takes']);

const unknownSource = (reason: string) => new GateRefusal('source-unknown', reason, ['list_cookie_sources — what can be imported']);

const keyRefusal = (failure: KeyUnavailable) =>
  failure.reason === 'away'
    ? new GateRefusal('host-away', failure.message, [
        'open the Tagma app on this machine: it reads the Keychain key of the browser, then import again',
      ])
    : new GateRefusal('key-refused', failure.message, [
        failure.reason === 'denied'
          ? 'import again and allow Tagma in the macOS Keychain prompt'
          : 'open the browser once so it stores its key, then import again',
      ]);

const sourceRefusal = (failure: SourceUnreadable | ProfileMissing | KeyUnavailable) => {
  switch (failure._tag) {
    case 'SourceUnreadable':
      return new GateRefusal('source-unreadable', failure.message, failure.unblock);
    case 'ProfileMissing':
      return unknownSource(failure.message);
    case 'KeyUnavailable':
      return keyRefusal(failure);
  }
};

const broken = (failure: CommandFailure | HostFailure) => `the write broke: ${failure.message}`;

const hostRefusal = (failure: HostFailure) =>
  failure._tag === 'HostRefused'
    ? new GateRefusal('host-refused', failure.message, failure.unblock)
    : failure.pending
      ? new GateRefusal('outcome-unknown', outcomeUnknown(failure.message).reason, ['list_cookie_sources, then import again'])
      : new GateRefusal('host-away', `the profile host stopped answering: ${failure.message}`, ['import again once the host is back']);

const away = Effect.fnUntraced(function* (profile: ProfileRecord) {
  const { all } = yield* HostAdapters;
  const hint = all.find((adapter) => adapter.id === profile.adapter)?.away;
  return new GateRefusal('host-away', `the host of profile ${profile.id} (${profile.adapter}) is not connected`, [
    hint ?? 'connect its host, then import again',
  ]);
});

const reached = Effect.fnUntraced(function* (profile: ProfileRecord) {
  const host = yield* (yield* Hosts)
    .reach(profile.adapter)
    .pipe(Effect.catchTag('HostAway', () => Effect.flatMap(away(profile), Effect.fail)));
  yield* host.profiles.prepare(profile).pipe(Effect.mapError(hostRefusal));
  return host;
});

const sessionOf = Effect.fnUntraced(function* (profile: ProfileRecord) {
  const host = yield* reached(profile);
  return yield* host.profiles.session(profile).pipe(Effect.mapError(hostRefusal));
});

const tagmaReading = Effect.fn('cookies.readProfile')(function* (profile: ProfileRecord) {
  const session = yield* sessionOf(profile);
  return yield* storedCookies(session).pipe(
    Effect.mapError(
      (failure) => new GateRefusal('source-unreadable', `profile ${profile.id} could not be read: ${failure.message}`, ['import again']),
    ),
  );
}, Effect.scoped);

const readingOf = Effect.fnUntraced(function* (origin: Origin, target: ProfileId, caller: Caller) {
  switch (origin.kind) {
    case 'tagma': {
      if (origin.profile === target) return yield* shape('a profile cannot import its own cookies');
      return yield* tagmaReading(yield* (yield* Profiles).record(origin.profile));
    }
    case 'file': {
      const file = isAbsolute(origin.file) ? origin.file : caller.files === null ? null : caller.files.resolve(origin.file);
      if (file === null) return yield* shape('a relative `file` needs a checkout; this call stands in none — name an absolute path');
      return yield* readCookieFile(file).pipe(Effect.mapError(sourceRefusal));
    }
    case 'browser': {
      const source = (yield* CookieSources).all.find((held) => held.id === origin.browser);
      if (source === undefined) return yield* unknownSource(`no browser ${origin.browser} is known to this server`);
      const profile = origin.profile ?? (yield* source.profiles.pipe(Effect.mapError(sourceRefusal)))[0]?.id;
      if (profile === undefined) return yield* unknownSource(`${source.title} keeps no profile with cookies on this machine`);
      return yield* source.read(profile).pipe(Effect.mapError(sourceRefusal));
    }
  }
});

const putBack = (session: Session, profile: ProfileRecord, plan: Plan, snapshot: readonly Cookie[], failure: CommandFailure | null) =>
  Effect.exit(
    failure?._tag === 'SessionEnded'
      ? Effect.scoped(Effect.flatMap(sessionOf(profile), (fresh) => restored(fresh, plan, snapshot)))
      : restored(session, plan, snapshot),
  );

const written = Effect.fn('cookies.write')(function* (profile: ProfileRecord, plan: Plan) {
  const session = yield* sessionOf(profile);
  const { cookies } = yield* storedCookies(session).pipe(
    Effect.mapError((failure) => new GateRefusal('import-broken', `${broken(failure)}; nothing was changed`, ['import again'])),
  );
  const snapshot: readonly Cookie[] = cookies.filter((cookie) => plan.covers(cookie.domain));
  return yield* replaced(session, plan, snapshot).pipe(
    Effect.onInterrupt(() =>
      Effect.flatMap(putBack(session, profile, plan, snapshot, null), (back) =>
        back._tag === 'Success'
          ? Effect.logInfo(`browser: an interrupted cookie import into profile ${profile.id} put the replaced cookies back`)
          : Effect.logWarning(
              `browser: an interrupted cookie import into profile ${profile.id} could not put the replaced cookies back`,
              back.cause,
            ),
      ),
    ),
    Effect.catchIf(isCommandFailure, (failure) =>
      Effect.flatMap(putBack(session, profile, plan, snapshot, failure), (back) =>
        Effect.fail(
          new GateRefusal(
            'import-broken',
            back._tag === 'Success'
              ? `${broken(failure)}; the cookies of the domains it replaces were put back as they stood`
              : `${broken(failure)}; putting back the cookies of the domains it replaces failed too, so some of them may be missing`,
            ['import again once the host of the profile answers'],
          ),
        ),
      ),
    ),
  );
}, Effect.scoped);

export const importCookies = Effect.fn('cookies.import')(function* (target: ProfileId, origin: Origin, caller: Caller) {
  const profiles = yield* Profiles;
  const profile = yield* profiles.record(target);
  const reading: Reading = yield* readingOf(origin, target, caller);
  const plan = planImport(reading.cookies, (yield* Clock.currentTimeMillis) / 1000);
  const outcome = plan.cookies.length === 0 ? { written: 0, rejected: 0 } : yield* profiles.exclusive(target, written(profile, plan));
  return {
    written: outcome.written,
    google: plan.google,
    unreadable: reading.unreadable,
    rejected: outcome.rejected,
    domains: plan.domains,
  } satisfies Imported;
});

export const cookieSources = Effect.fn('cookies.sources')(function* () {
  const { all } = yield* CookieSources;
  const listed = yield* Effect.forEach(
    all,
    (source) =>
      source.profiles.pipe(
        Effect.map((profiles) => ({ id: source.id, title: source.title, access: source.access, profiles, unreadable: null })),
        Effect.catchTag('SourceUnreadable', (failure) =>
          Effect.succeed({ id: source.id, title: source.title, access: source.access, profiles: [], unreadable: failure.message }),
        ),
      ),
    { concurrency: 3 },
  );
  return {
    browsers: listed.filter((browser) => browser.profiles.length > 0 || browser.unreadable !== null),
    profiles: yield* (yield* Profiles).list,
  };
});
