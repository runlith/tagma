import { Schema } from 'effect';
import { extensionsOf, type Languages } from '../../../core/languages';
import { bare, baseOrRoot, describeFiles, distinct, entry, filesOrAll, inRegion } from '../../../core/params';
import type { Shown } from '../../../core/rule';

const languages: Languages = ['js'];

const files = filesOrAll(extensionsOf(languages));

const exactFile = entry.check(Schema.makeFilter((path) => (path.endsWith('/') ? 'a tag is declared in one file' : undefined)));

const Tag = Schema.Struct({
  path: exactFile,
  symbol: Schema.String.check(Schema.isPattern(/^[A-Za-z_$][\w$]*$/u)).annotate({
    description: 'The exported name the file declares the tag under.',
  }),
});

export type TagRef = typeof Tag.Type;

export const tagKey = (tag: TagRef): string => `${bare(tag.path)}#${tag.symbol}`;

const params = Schema.Struct({
  base: baseOrRoot,
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
  tags: Schema.NonEmptyArray(Tag)
    .check(Schema.makeFilter((tags) => (new Set(tags.map(tagKey)).size === tags.length ? undefined : 'a tag is named once')))
    .annotate({ description: 'The call-service tags, each by the file relative to `base` that declares it and its exported name.' }),
  allow: Schema.Array(entry)
    .check(Schema.makeFilter((entries) => (distinct(entries) ? undefined : 'an allowed entry is named once')))
    .annotate({ description: 'The directories (ending in `/`) and files, relative to `base`, that may provide the tags.' }),
});

export type CallServicesParams = typeof params.Type;

export const allowedAt = (value: CallServicesParams, local: string): boolean =>
  value.allow.some((one) => (one.endsWith('/') ? local.startsWith(one) : local === one));

const describe = (value: CallServicesParams): string =>
  `Call services ${describeFiles(value.base, value.files)}, judging files in ${value.region.map((one) => `\`${one}\``).join(', ')}: ${value.tags.map((tag) => `\`${tag.path}#${tag.symbol}\``).join(', ')} are provided only in ${value.allow.length === 0 ? 'no file' : value.allow.map((one) => `\`${one}\``).join(', ')} — no other file names one in \`Effect.provideService\` or \`Effect.provideServiceEffect\`, in \`Layer.succeed\`, \`Layer.effect\`, \`Layer.sync\` or \`Layer.scoped\`, or in a \`Context.make\` or \`Context.add\` written inside the arguments of \`Effect.provide\`, \`Effect.provideContext\`, \`Effect.setContext\`, \`Effect.updateContext\`, \`Layer.succeedContext\` or \`Layer.provide\`.`;

const shows = (value: CallServicesParams): Shown => ({
  figures: [
    {
      kind: 'lists',
      lists: [
        { label: 'Services', items: value.tags.map(({ path, symbol }) => `${symbol} · ${path}`) },
        { label: 'Only provided in', items: value.allow },
        { label: 'Judged in', items: value.region },
      ],
    },
  ],
});

export const callServices = {
  id: 'call-services',
  params,
  summary: 'The named Effect services are provided only in the allowed files.',
  concern: 'code',
  lists: [{ at: 'allow', item: entry, key: entry, identity: [] }],
  describe,
  shows,
  relevant: (value: CallServicesParams, path: string): boolean =>
    inRegion(value, path) && value.files.extensions.some((extension) => path.endsWith(extension)),
  languages,
  reach: 'local',
  fileLocal: true,
  calibrated: true,
  unit: 'provision site',
  limitations: [
    'A tag is read where the file names it: an import of its declared name from its declaring file — a relative specifier resolved against the importing file, `.js` read as `.ts` — a member of a namespace import of that file, or its own name inside the declaring file. A tag reached through a re-export, an alias variable or a value passed in from elsewhere is not read.',
    'Receivers are the names a file imports as `Effect`, `Layer` and `Context` from `effect`; a namespace import of `effect`, the `effect/Effect` subpaths and a local that shadows one of them are read by name only.',
    'A `Context` built in one statement and provided in another — assigned to a variable, returned from a helper, or passed as a parameter — is not read; only a `Context.make` or `Context.add` written inside the provider call’s arguments is.',
    'The fingerprint names the file relative to `base`, the top-level declaration holding the site, the tag and the form; a second site with the same four carries a `#n` suffix in source order.',
    'Only files mentioning one of the tags’ names are read.',
    'A reading past its calibrated envelope is refused as too large, never judged clean. The envelope is calibrated on the machine that judges by timing a cold read and parse of a probe of up to 16 selected files or 512 KiB: a reading of F files and M MiB is refused where 10 s + max(F·t/f, M·t/m) would pass 120 s, t being the probe time and f, m its files and MiB. The server keeps the calibration per repository — in its workers and in its inspection cache, which every server start clears — and reuses it only while the subject fits it, measuring again past that; the inspections CLI measures on every run. A reading that measured no probe stays bounded by the probe size.',
    'A selected file whose text does not parse fails the whole inspection, never reads as a file providing nothing.',
  ],
  unblock: [
    'Hand the door’s facts to `invocation` — `Admission.carry` for an admitted call, `callServices` inside invocation — and let it provide the call’s services.',
    'A test provides them through invocation’s testing double.',
  ],
} as const;
