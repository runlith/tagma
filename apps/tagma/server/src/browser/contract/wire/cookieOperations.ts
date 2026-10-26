import { Schema } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ProfileId } from './ids.js';
import { Profile } from './profile.js';
import { MACHINE_ACTING, MACHINE_READING } from './shape.js';

export const CookieBrowser = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  access: Schema.NullOr(Schema.Literals(['keychain', 'full-disk'])).annotate({
    description:
      '`keychain`: reading it asks macOS for the browser key, which the Tagma app reads; `full-disk`: it needs Full Disk Access.',
  }),
  profiles: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  unreadable: Schema.NullOr(Schema.String),
});

export const COOKIE_REFUSALS = [
  'profile-unknown',
  'host-away',
  'host-refused',
  'outcome-unknown',
  'action-shape',
  'source-unknown',
  'source-unreadable',
  'key-refused',
  'import-broken',
] as const;

export const COOKIE_OPERATIONS = {
  list_cookie_sources: operation('list_cookie_sources', {
    ...MACHINE_READING,
    meaning:
      'List what import_cookies can read from: the browsers installed on this machine with their profiles, and the browser profiles of Tagma.',
    grammar:
      'A browser appears with each of its profiles that keeps cookies; `unreadable` says why its profiles could not be listed. Reading a Chromium-family browser later asks macOS for its Keychain key, which the Tagma app reads.',
    input: Schema.Struct({}),
    answer: arms({ listed: { browsers: Schema.Array(CookieBrowser), profiles: Schema.Array(Profile) } }),
    refusals: [],
    confirmation: () => ({ summary: 'List the cookie sources?' }),
    confirmLabel: 'List cookie sources',
    presentation: { running: 'Listing the cookie sources', done: 'Listed the cookie sources' },
  }),
  import_cookies: operation('import_cookies', {
    ...MACHINE_ACTING,
    meaning: 'Copy the sign-ins of a browser profile, another Tagma profile or a cookie file into a Tagma browser profile.',
    grammar:
      'Name exactly one source: `browser` with `browserProfile` as list_cookie_sources answered them (without `browserProfile`, its first profile), `from` — another Tagma profile, or `file` — a JSON array of cookies as browser extensions export them. Cookies of google.com never cross: sign in to Google inside Tagma. The import replaces the cookies of the domains it brings, their parent and child domains, and leaves every other cookie of the profile as it stands. `rejected` counts cookies the browser store refused one by one; `unreadable` the cookies the source holds but could not be read faithfully — encrypted with a key Tagma cannot use or stored in a partition it does not record. A write that breaks midway puts the replaced cookies back and refuses `import-broken`.',
    input: Schema.Struct({
      profile: ProfileId.annotate({ description: 'The Tagma profile that receives the cookies, as list_profiles answered it.' }),
      browser: Schema.optional(Schema.String).annotate({ description: 'A browser id list_cookie_sources answered.' }),
      browserProfile: Schema.optional(Schema.String).annotate({ description: 'A profile id of that browser.' }),
      from: Schema.optional(ProfileId).annotate({ description: 'Another Tagma profile to copy the cookies of.' }),
      file: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        description: 'A JSON cookie file: absolute, or relative to the checkout this call stands in.',
      }),
    }),
    answer: arms({
      imported: {
        profile: ProfileId,
        written: Schema.Int,
        google: Schema.Int,
        unreadable: Schema.Int,
        rejected: Schema.Int,
        domains: Schema.Array(Schema.String),
      },
    }),
    refusals: COOKIE_REFUSALS,
    confirmation: (input) => ({ summary: `Import cookies into the profile ${input.profile}?` }),
    confirmLabel: 'Import cookies',
    presentation: { running: 'Importing cookies', done: 'Imported cookies' },
  }),
};

export type CookieOperationId = keyof typeof COOKIE_OPERATIONS;
