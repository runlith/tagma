import { Schema } from 'effect';
import { extensionsOf, type Languages } from '../../../core/languages';
import { base, describeFiles, distinct, entry, filesOf } from '../../../core/params';
import { recordList, type Figure, type Shown } from '../../../core/rule';

const languages: Languages = ['js'];

const files = filesOf(extensionsOf(languages));

const glob = Schema.NonEmptyString;

const globs = Schema.Array(glob).annotate({ description: 'Glob patterns matched against the path relative to `base`.' });

const word = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9]*$/u)).annotate({
  description: 'One word as an identifier spells it; words compare without case.',
});

const identifier = Schema.String.check(Schema.isPattern(/^[A-Za-z_$][\w$]*$/u));

const exactFile = entry.check(
  Schema.makeFilter((path) => (path.endsWith('/') || /[?*{}\[\]]/.test(path) ? 'an S8 exception names one exact file' : undefined)),
);

const count = Schema.Int.check(Schema.isGreaterThan(0));

const exempt = { exempt: globs };

const DECLARATION_KINDS = ['class', 'function', 'variable', 'type', 'interface', 'enum', 'namespace'] as const;

const LITERAL_POSITIONS = ['compare', 'argument', 'property', 'lookup'] as const;

const exclusion = Schema.Struct({ path: Schema.NonEmptyString, subject: Schema.NonEmptyString, why: Schema.NonEmptyString });
const allowance = Schema.Struct({ path: Schema.NonEmptyString, lines: count, why: Schema.NonEmptyString });

const checks = Schema.Struct({
  F1: Schema.optional(
    Schema.Struct(exempt).annotate({
      description: "No file is named after its own directory or its singular; a module's own `<module>/<module>.ts` stands.",
    }),
  ),
  F2: Schema.optional(
    Schema.Struct(exempt).annotate({
      description: "A file's first word is none of its directory's words, a module directory counting with each of its words.",
    }),
  ),
  F3: Schema.optional(
    Schema.Struct({
      lines: count.annotate({ description: 'A one-word plural stem is a violation over this many lines.' }),
      excluded: Schema.Array(exclusion).annotate({
        description:
          'Exact paths, relative to `base`, whose short plural stem a card declared honest, with its one subject and the reason.',
      }),
    }),
  ),
  F4: Schema.optional(
    Schema.Struct({
      lines: count.annotate({ description: 'The line budget: a file over it is a violation whose value is its line count.' }),
      allowances: Schema.Array(allowance).annotate({
        description: 'A file, relative to `base`, allowed up to its own budget, with the reason it holds one subject.',
      }),
    }),
  ),
  F5: Schema.optional(Schema.Struct({ exports: count.annotate({ description: 'A file exporting this many top-level names or more.' }) })),
  F6: Schema.optional(
    Schema.Struct({ files: count.annotate({ description: 'A directory holding more than this many selected files at one level.' }) }),
  ),
  F7: Schema.optional(Schema.Struct(exempt).annotate({ description: 'Two files of one module sharing a stem.' })),
  S1: Schema.optional(
    Schema.Struct({ words: count.annotate({ description: 'An exported name of this many semantic words or more.' }), ...exempt }),
  ),
  S2: Schema.optional(
    Schema.Struct({
      prefix: word.annotate({ description: 'The product prefix no exported name opens with, followed by a capital.' }),
      kernel: Schema.Array(Schema.NonEmptyString).annotate({
        description:
          'Specifiers (and their subpaths) whose same-named binding, imported into the file, allows the prefixed name until the two models merge.',
      }),
      ...exempt,
    }),
  ),
  S3: Schema.optional(
    Schema.Struct({ suffixes: Schema.NonEmptyArray(word).annotate({ description: 'Last words no service key ends in.' }), ...exempt }),
  ),
  S4: Schema.optional(
    Schema.Struct({
      within: Schema.Literals(['module', 'region']).annotate({
        description: 'One exported type name declared in two files of one module (`module`), or in two modules of the region (`region`).',
      }),
      ...exempt,
    }),
  ),
  S5: Schema.optional(
    Schema.Struct({
      heads: Schema.NonEmptyArray(word).annotate({ description: 'Generic words no exported name ends in.' }),
      allows: Schema.Array(Schema.Struct({ head: word, in: Schema.NonEmptyArray(glob) })).annotate({
        description: 'A head allowed in the files the globs match, where it is the transport’s own term.',
      }),
      ...exempt,
    }),
  ),
  S6: Schema.optional(
    Schema.Struct(exempt).annotate({
      description: "A member of an exported class or interface repeating its owner's first word or its file's.",
    }),
  ),
  S7a: Schema.optional(Schema.Struct(exempt).annotate({ description: "The glossary's retired spellings in exported names." })),
  S7b: Schema.optional(
    Schema.Struct(exempt).annotate({ description: "The glossary's reserved words in exported names outside their owners' regions." }),
  ),
  S8: Schema.optional(
    Schema.Struct({
      conditions: Schema.NonEmptyArray(word).annotate({ description: 'The words an exported failure class ends in.' }),
      names: Schema.Array(identifier).annotate({ description: 'Exported names the failure form does not judge.' }),
      notJudged: Schema.optional(
        Schema.Array(Schema.Struct({ path: exactFile, name: identifier, why: Schema.NonEmptyString })).annotate({
          description:
            'Exact file and exported name pairs the form reader cannot prove, with the reason each remains outside the judgement.',
        }),
      ),
      ...exempt,
    }),
  ),
  S9: Schema.optional(
    Schema.Struct({
      id: Schema.NonEmptyString.check(Schema.isPattern(/\{name\}/u)).annotate({
        description: 'The id every service key carries, `{module}` and `{name}` filled from its file and its class.',
      }),
      suffixes: Schema.NonEmptyArray(word).annotate({ description: 'Last words no service key ends in.' }),
      testing: globs.annotate({ description: 'Files where an exported class may implement a service shape.' }),
      ...exempt,
    }),
  ),
  S10: Schema.optional(
    Schema.Struct({
      nouns: count.annotate({
        description: "A service shape whose member names carry this many distinct words besides the key's own and the verbs.",
      }),
      verbs: Schema.Array(word).annotate({ description: 'Words a member name carries that are not nouns: verbs and particles.' }),
      ...exempt,
    }),
  ),
  S11: Schema.optional(
    Schema.Struct({
      participles: Schema.Array(word).annotate({ description: 'Past participles not ending in `ed`.' }),
      ...exempt,
    }),
  ),
  literals: Schema.optional(
    Schema.Array(
      Schema.Struct({
        region: Schema.NonEmptyArray(glob),
        words: Schema.NonEmptyArray(Schema.NonEmptyString),
        positions: Schema.NonEmptyArray(Schema.Literals(LITERAL_POSITIONS)),
        allowIn: globs,
      }),
    ).annotate({ description: 'String literals no file of `region` writes in a tag position, outside `allowIn`.' }),
  ),
});

const compiles = (source: string): boolean => {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
};

const retired = Schema.Struct({
  sense: Schema.NonEmptyString,
  spelling: Schema.optional(word.annotate({ description: 'A word as it stands inside names; with `at`.' })),
  at: Schema.optional(
    Schema.Literals(['any', 'first', 'last']).annotate({ description: 'Where in a name the spelling is a word: anywhere, first or last.' }),
  ),
  pattern: Schema.optional(
    Schema.NonEmptyString.check(
      Schema.makeFilter((source) => (compiles(source) ? undefined : 'a pattern is a regular expression')),
    ).annotate({
      description:
        'A regular expression matched against the whole exported name, for a retired compound such as `^EnvironmentProviders?$`; instead of `spelling`.',
    }),
  ),
  kinds: Schema.Array(Schema.Literals(DECLARATION_KINDS)).annotate({ description: 'The declarations it is judged on; empty, every kind.' }),
  replacement: Schema.NonEmptyString,
  regions: Schema.NonEmptyArray(glob),
  exempt: Schema.Struct({ paths: globs, names: Schema.Array(identifier) }),
}).check(
  Schema.makeFilter((value) =>
    value.pattern === undefined
      ? value.spelling !== undefined && value.at !== undefined
        ? undefined
        : 'a retirement names a spelling with `at`, or a pattern'
      : value.spelling === undefined && value.at === undefined
        ? undefined
        : 'a retirement names a spelling or a pattern, never both',
  ),
);

const term = Schema.Struct({
  word,
  meaning: Schema.NonEmptyString,
  owner: Schema.NonEmptyString,
  regions: globs.annotate({ description: "The owner's regions, relative to `base`." }),
  reserved: Schema.Boolean.annotate({ description: "Whether an exported name carrying the word outside the owner's regions is a signal." }),
  retired: Schema.Array(retired),
});

const params = Schema.Struct({
  base,
  files,
  uncovered: Schema.Array(Schema.Struct({ path: entry, until: Schema.NonEmptyString })).annotate({
    description:
      'Directories and files, from the repository root, the rule does not judge yet, each with what it waits for; one under `base` is not read, and every description of the rule names them all.',
  }),
  modules: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, territory: Schema.Array(entry) })).annotate({
    description:
      "The modules and the directories and files each owns, relative to `base`: a file belongs to the module of the longest entry covering it, else to the first directory under `base` that holds it. A module's own directory is the entry named after its id.",
  }),
  services: Schema.NonEmptyArray(Schema.NonEmptyString).annotate({
    description: 'A service key’s class heritage as written, `Context.Service`.',
  }),
  errors: Schema.NonEmptyArray(Schema.NonEmptyString).annotate({
    description: 'A failure class’s heritage as written, `Data.TaggedError`.',
  }),
  checks,
  glossary: Schema.Array(term),
}).check(
  Schema.makeFilter((value) => {
    if (new Set(value.modules.map(({ id }) => id)).size !== value.modules.length) return 'a module is named once';
    if (!distinct(value.modules.flatMap(({ territory }) => territory))) return 'a territory entry belongs to one module';
    if (!distinct(value.uncovered.map(({ path }) => path))) return 'an uncovered path is named once';
    const { F3, F4 } = value.checks;
    if (F3 !== undefined && !distinct(F3.excluded.map(({ path }) => path))) return 'an F3 exclusion names its path once';
    if (F4 !== undefined && !distinct(F4.allowances.map(({ path }) => path))) return 'an F4 allowance names its path once';
    if (value.checks.S8 !== undefined && !distinct((value.checks.S8.notJudged ?? []).map(({ path, name }) => `${path}#${name}`)))
      return 'an S8 exception names its exact file and name once';
    const words = value.glossary.map((one) => one.word.toLowerCase());
    return new Set(words).size === words.length ? undefined : 'a glossary word is named once';
  }),
);

type Params = typeof params.Type;

type Checks = Params['checks'];

export type Term = Params['glossary'][number];

const listed = (values: readonly string[]): string => values.map((one) => `\`${one}\``).join(', ');

const except = (exempted: readonly string[]): string => (exempted.length === 0 ? '' : `, except ${listed(exempted)}`);

const checkLines = (checks: Checks): readonly string[] => {
  const lines: string[] = [];
  const { F1, F2, F3, F4, F5, F6, F7, S1, S2, S3, S4, S5, S6, S7a, S7b, S8, S9, S10, S11, literals } = checks;
  if (F1 !== undefined)
    lines.push(
      `F1 no file is named after its own directory or its singular; a module's \`<module>/<module>.ts\` stands${except(F1.exempt)}.`,
    );
  if (F2 !== undefined) lines.push(`F2 a file's first word is none of its directory's words${except(F2.exempt)}.`);
  if (F3 !== undefined) {
    const honest = F3.excluded.length === 0 ? '' : `; honest by their cards: ${listed(F3.excluded.map(({ path }) => path))}`;
    lines.push(`F3 no one-word plural stem over ${F3.lines} lines${honest}.`);
  }
  if (F4 !== undefined) {
    const allowed = F4.allowances.map(({ path, lines: budget }) => `\`${path}\` to ${budget}`).join(', ');
    lines.push(`F4 no file over ${F4.lines} lines outside its import statements${allowed === '' ? '' : `; allowed: ${allowed}`}.`);
  }
  if (F5 !== undefined) lines.push(`F5 no file exports ${F5.exports} or more top-level names.`);
  if (F6 !== undefined)
    lines.push(`F6 no directory holds more than ${F6.files} selected files at one level; each file there is one place.`);
  if (F7 !== undefined)
    lines.push(`F7 no two files of one module share a stem unless each stands in its own concept directory${except(F7.exempt)}.`);
  if (S1 !== undefined) lines.push(`S1 no exported name of ${S1.words} or more words${except(S1.exempt)}.`);
  if (S2 !== undefined) {
    const kernel = S2.kernel.length === 0 ? '' : ` unless the file imports the same name unprefixed from ${listed(S2.kernel)}`;
    lines.push(`S2 no exported name opens with \`${S2.prefix}\` and a capital${kernel}${except(S2.exempt)}.`);
  }
  if (S3 !== undefined) lines.push(`S3 no service key ends in ${listed(S3.suffixes)}${except(S3.exempt)}.`);
  if (S4 !== undefined) {
    lines.push(
      `S4 no exported type name is declared in two ${S4.within === 'module' ? 'files of one module' : 'modules'}; each declaring file is one place${except(S4.exempt)}.`,
    );
  }
  if (S5 !== undefined) {
    const allowed = S5.allows.map((one) => `\`${one.head}\` in ${listed(one.in)}`).join('; ');
    lines.push(`S5 no exported name ends in ${listed(S5.heads)}${allowed === '' ? '' : `; allowed: ${allowed}`}${except(S5.exempt)}.`);
  }
  if (S6 !== undefined)
    lines.push(`S6 no member of an exported class or interface repeats its owner's first word or its file's${except(S6.exempt)}.`);
  if (S7a !== undefined) lines.push(`S7a no exported name carries a retired spelling of the glossary below${except(S7a.exempt)}.`);
  if (S7b !== undefined) lines.push(`S7b no exported name carries a reserved word outside its owner's regions${except(S7b.exempt)}.`);
  if (S8 !== undefined) {
    lines.push(
      `S8 an exported failure class ends in ${listed(S8.conditions)} with its \`_tag\` equal to its name; a \`…Failure\` is a union, never a class or a record, a \`…Failed\` never a type alias, a \`…Refusal\` a union of string literals or of \`…Refusal\`/\`…Refused\` types${S8.names.length === 0 ? '' : `; not judged: ${listed(S8.names)}`}${(S8.notJudged ?? []).map(({ path, name, why }) => `; not judged: \`${name}\` at \`${path}\` (${why})`).join('')}${except(S8.exempt)}.`,
    );
  }
  if (S9 !== undefined) {
    lines.push(
      `S9 a service key's id is \`${S9.id}\` and no other key holds it, its name ends in none of ${listed(S9.suffixes)}, its shape is inline, a package's type, or a generic contract its module declares once, given its type arguments, and no exported class outside ${S9.testing.length === 0 ? 'nowhere' : listed(S9.testing)} implements a shape${except(S9.exempt)}.`,
    );
  }
  if (S10 !== undefined)
    lines.push(
      `S10 a service shape's member names carry fewer than ${S10.nouns} words besides the key's own and the verbs${except(S10.exempt)}.`,
    );
  if (S11 !== undefined) lines.push(`S11 a published event's name ends in a past participle${except(S11.exempt)}.`);
  for (const one of literals ?? []) {
    lines.push(
      `Literals: no file of ${listed(one.region)} writes ${listed(one.words)} in a ${one.positions.join(', ')} position${one.allowIn.length === 0 ? '' : `, outside ${listed(one.allowIn)}`}.`,
    );
  }
  return lines;
};

const glossaryLines = (glossary: readonly Term[], checks: Checks): readonly string[] => [
  ...(checks.S7a === undefined
    ? []
    : glossary.flatMap((term) =>
        term.retired.map(
          (gone) =>
            `Retired: \`${gone.spelling ?? `/${gone.pattern ?? ''}/`}\` (${gone.sense}) → ${gone.replacement}${except(gone.exempt.names)}.`,
        ),
      )),
  ...(checks.S7b === undefined
    ? []
    : glossary.filter((term) => term.reserved).map((term) => `Reserved: \`${term.word}\` to ${listed(term.regions)} (${term.owner}).`)),
];

const describe = (value: Params): string =>
  [
    `Names ${describeFiles(value.base, value.files)}: syntactic signals of a name, never its truth.${
      value.uncovered.length === 0
        ? ''
        : ` Not judged yet: ${value.uncovered.map(({ path, until }) => `\`${path}\` (until ${until})`).join(', ')}.`
    }`,
    ...checkLines(value.checks),
    ...glossaryLines(value.glossary, value.checks),
  ].join('\n');

const shows = (value: Params): Shown => {
  const { F4, ...rest } = value.checks;
  const others = checkLines(rest);
  const figures: Figure[] = [];
  if (F4 !== undefined) {
    figures.push({
      kind: 'thresholds',
      thresholds: [
        { glob: '**', metric: 'non-import', lines: F4.lines },
        ...F4.allowances.map(({ path, lines, why }) => ({ glob: path, metric: 'non-import', lines, why })),
      ],
    });
  }
  if (others.length > 0) figures.push({ kind: 'lists', lists: [{ label: 'Checks', items: others }] });
  return F4 !== undefined && others.length === 0 ? { concern: 'size', figures } : { figures };
};

export const names = {
  id: 'names',
  params,
  summary: 'Files, folders and exported names follow the naming checks the project switches on.',
  concern: 'code',
  lists: [recordList('checks.F3.excluded', exclusion, ['path']), recordList('checks.F4.allowances', allowance, ['path'])],
  describe,
  shows,
  languages,
  reach: 'local',
  calibrated: true,
  unit: 'signal × path, or signal × exported name',
  follows: () => true,
  limitations: [
    'Words split at case changes, digits following letters, and every other character; an acronym run is one word. A plural is a word ending in `s` but not in `ss`, `us` or `is`, and two words are one when either is the other with `s`, `es` or `ies`→`y` taken off.',
    "A file's module is the module of the longest `modules` territory entry covering it, else the first directory under `base` that holds it; a module's own directory is its entry named after its id. F1's assembly file, F2's module words, F7's concept directories, S4 and S9's `{module}` read it.",
    'An exported name is one a module declares itself, by `export` or by an `export { … }` of its own declaration; a forwarded or default-anonymous export is not one. A file embedding several scripts exports only from its module script. S9 also reads non-exported service keys.',
    'F3 and F4 count the lines outside import statements, so rewriting imports never moves them; F4 carries the count as its value, recorded for a file in debt and never judged against it. F3 carries no count.',
    'F6, F7 and S4 name each place — a file of a wide directory, a file sharing a stem, a file declaring a duplicated name — so debt is a set of places: a new place is new, whatever else stands in debt. A judgement names only the places its changed files are.',
    "S4 and S9's shared ids find the other declarers through the tree's mentions of the name or id — `git grep` in a worker and the runner — and read only those files; a whole-reach reading uses what it has read. A tree that answers no mentions is scanned text by text.",
    'S3, S8 and S9 read a heritage through the import that brought it in, an alias or a namespace of an `effect/` module included.',
    'S8 judges a `…Refusal` or `…Failure` type alias written as a union, a string literal, a type reference or an object type, and reads three `typeof` forms against a `const` of the same file: `(typeof C)[number]` over an `as const` array of strings and `keyof typeof C` over an object literal are string literals; `typeof C.Type` or `.Encoded` is an object type where `C` is a `Schema.Struct` or `Schema.TaggedStruct`, or a `Schema.Union` of them piped through nothing but `Schema.toTaggedUnion`. `typeof t.$inferSelect` or `.$inferInsert` is a table row, an object type. A member written otherwise — another schema, an imported value, a deeper index — is named in `unjudged` with the form it holds, never read as clean.',
    "S9's shape is an application type when the file declares it or brings it in by a relative import, a namespace one included; a package's type stands.",
    'S11 reads the element type of a `PubSub` written in the same file and the members of an exported `…Event` union; a feed schema is not read.',
    'A literal is in a tag position when it is compared with, switched on, passed to, looked up in or assigned as a property of a name whose words include `tag` or `tags` and end in `tag`, `tags`, `id` or `ids`, or passed to a same-file function whose parameter is so named.',
    'The fingerprint names the file relative to `base`, and for a name the name. A change that deletes a file and adds one with the same text outside its import statements carries every violation of the file to the new path, and the verdict names the pair; any other edit on the way — a symbol renamed by the map included — makes them new. A wave moves a file in one commit and renames inside it in the next.',
    'A reading whose facts would pass section 3 §3.12’s 120 s ask ceiling on this machine is refused as too large, never judged clean. The envelope is calibrated per machine by timing a cold declaration parse of up to 16 selected files or 512 KiB, filled from the reach when the change is smaller, and charged per file and per MiB each at the whole probe time; until a probe has run, a reading is bounded by the probe size. One budget covers both sides of a judgement and the move reads, and a reach is admitted from the listing sizes before anything is read. Walking the listing for F6 and F7 is not metered.',
    'A selected file whose text is not UTF-8 or does not parse fails the whole inspection; `files.exclude` naming it is the way past.',
  ],
  unblock: [
    'Rename or move by meaning: a file holding one subject is renamed or moved, and a split follows named subjects only.',
    'Move a file in one commit with nothing else changed but its imports, so its debt follows it; rename inside it in the next.',
  ],
} as const;
