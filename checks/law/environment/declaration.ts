import { Schema } from 'effect';
import { extensionsOf, type Languages } from '../languages';
import { bare, base, distinct, entry, filesOf } from '../params';

const languages: Languages = ['js'];

const files = filesOf(extensionsOf(languages));

const Allowance = Schema.Struct({
  path: entry,
  why: Schema.NonEmptyString.annotate({ description: 'One line: why this place may read it directly.' }),
});

export type Allowance = typeof Allowance.Type;

const allowances = Schema.Array(Allowance)
  .check(Schema.makeFilter((places) => (distinct(places.map((one) => one.path)) ? undefined : 'an allowed place is named once')))
  .annotate({ description: 'The directories (ending in `/`) and files, relative to `base`, that may read it, each with its reason.' });

const instead = Schema.NonEmptyString.annotate({ description: 'The service a feature takes instead, named in each finding.' });

const NAME = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/u;

const Global = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(NAME)).annotate({
    description:
      'A global (`fetch`) or one member of a global (`navigator.serviceWorker`). A global matches every free read of it, through `window.`, `globalThis.` or `self.` too; a member matches only a read of that member off the free global, a string `in` test included.',
  }),
  instead,
  allow: allowances,
});

const Import = Schema.Struct({
  specifier: Schema.String.check(Schema.isPattern(/^[^\s*]+(?:\/\*)?$/u)).annotate({
    description: 'A module specifier as written, or a prefix ending in `/*` that matches its subpaths.',
  }),
  instead,
  allow: allowances,
});

const covered = (names: readonly string[]): string | undefined =>
  names.find((name) => name.includes('.') && names.includes(name.slice(0, name.indexOf('.'))));

const params = Schema.Struct({
  base,
  region: Schema.NonEmptyArray(entry)
    .check(
      Schema.makeFilter((entries) =>
        !distinct(entries)
          ? 'a region entry is named once'
          : entries.some((one) => !one.endsWith('/'))
            ? 'a region entry is a directory prefix'
            : undefined,
      ),
    )
    .annotate({ description: 'The directory prefixes, relative to `base`, whose selected files are judged; every entry ends in `/`.' }),
  files,
  globals: Schema.Array(Global)
    .check(
      Schema.makeFilter((globals) => {
        const names = globals.map((one) => one.name);
        if (new Set(names).size !== names.length) return 'a global is named once';
        const member = covered(names);
        return member === undefined ? undefined : `\`${member}\` is already covered by its global's own entry`;
      }),
    )
    .annotate({ description: 'The globals a selected file may not read outside the places each allows.' }),
  imports: Schema.Array(Import)
    .check(
      Schema.makeFilter((imports) =>
        new Set(imports.map((one) => one.specifier)).size === imports.length ? undefined : 'a specifier is named once',
      ),
    )
    .annotate({ description: 'The module specifiers a selected file may not import outside the places each allows.' }),
});

export type EnvironmentParams = typeof params.Type;

export const allowedAt = (places: readonly Allowance[], local: string): boolean =>
  places.some((one) => (one.path.endsWith('/') ? local.startsWith(one.path) : local === bare(one.path)));

export const environment = { id: 'environment', params } as const;
