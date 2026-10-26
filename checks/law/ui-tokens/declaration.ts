import { Schema } from 'effect';
import { bare, base, distinct, entry, filesOf } from '../params';

const files = filesOf(['.svelte', '.ts', '.css']);

const names = (description: string) => Schema.Array(Schema.NonEmptyString).annotate({ description });

const allow = Schema.Struct({
  text: names('The font-size names `text-<name>` may take.'),
  textColors: names('The colour token names `text-<name>` may take, as the token file declares them.'),
  rounded: names('The radius names `rounded-<name>` and its side forms may take; a bare `rounded` is never allowed.'),
  shadow: names('The names `shadow-<name>` may take.'),
  spacing: names('The steps padding, margin, gap and space utilities may take.'),
  icon: names('The steps `size-<step>` may take on an icon component.'),
  stateBackgrounds: Schema.optional(
    names(
      'The names `bg-<name>` may take under a hover, highlighted, open or selected variant; no other background, opacity variants included. Absent, that family is not judged.',
    ),
  ),
});

const Literals = Schema.Struct({
  path: entry,
  why: Schema.NonEmptyString.annotate({
    description: 'One line: why this place may hold colour literals and literal lengths in declarations.',
  }),
});

const Casing = Schema.Struct({
  path: entry,
  why: Schema.NonEmptyString.annotate({ description: 'One line: why this place may use `uppercase` and `tracking-*`.' }),
});

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
  allow,
  icons: Schema.Array(Schema.NonEmptyString).annotate({
    description:
      'Module specifier prefixes whose imports are icon components; each such element carries an explicit allowed `size-` class.',
  }),
  literals: Schema.Array(Literals)
    .check(Schema.makeFilter((places) => (distinct(places.map((one) => one.path)) ? undefined : 'a literals entry is named once')))
    .annotate({
      description:
        'The directories (ending in `/`) and files, relative to `base`, that may hold colour literals and literal lengths in declarations, each with its reason.',
    }),
  casing: Schema.optional(
    Schema.Array(Casing)
      .check(Schema.makeFilter((places) => (distinct(places.map((one) => one.path)) ? undefined : 'a casing entry is named once')))
      .annotate({
        description:
          'The directories (ending in `/`) and files, relative to `base`, that may use `uppercase`, `tracking-*`, `text-transform: uppercase` and a non-zero `letter-spacing`, each with its reason. Absent, none of them is judged.',
      }),
  ),
});

export type UiTokensParams = typeof params.Type;

const placed = (places: readonly { readonly path: string }[], local: string): boolean =>
  places.some((one) => (one.path.endsWith('/') ? local.startsWith(one.path) : local === bare(one.path)));

export const literalsAt = (value: UiTokensParams, local: string): boolean => placed(value.literals, local);

export const casingJudged = (value: UiTokensParams, local: string): boolean => value.casing !== undefined && !placed(value.casing, local);

export const uiTokens = { id: 'ui-tokens', params } as const;
