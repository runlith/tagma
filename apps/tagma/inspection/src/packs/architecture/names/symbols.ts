import type { Binding, Declared, Made, Outline, Union } from '@runlith/code-facts/js';
import type { Term } from './declaration';
import { covered, type Reading, report, type Seat } from './reading';
import { isPlural, sameWord, stemOf, wordsOf } from './words';

type Retired = Term['retired'][number];

const TYPED: ReadonlySet<Declared['kind']> = new Set(['type', 'interface', 'class', 'enum']);

const lastWord = (name: string): string => wordsOf(name).at(-1) ?? '';

const sameText = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

const canonicalWord = (word: string): string => {
  const lowered = word.toLowerCase();
  if (!isPlural(lowered)) return lowered;
  if (lowered.endsWith('ies')) return `${lowered.slice(0, -3)}y`;
  if (/(ch|sh|x|z)es$/.test(lowered)) return lowered.slice(0, -2);
  return lowered.slice(0, -1);
};

const LIBRARY_ROOT = 'effect/';

export const heritage = (written: string | undefined, bindings: readonly Binding[]): string | undefined => {
  if (written === undefined) return undefined;
  const [head = '', ...rest] = written.split('.');
  const binding = bindings.find((one) => one.local === head);
  if (binding === undefined) return written;
  const module = binding.specifier.startsWith(LIBRARY_ROOT) ? binding.specifier.slice(LIBRARY_ROOT.length) : undefined;
  if (binding.imported === '*') return module === undefined ? written : [module, ...rest].join('.');
  const imported = binding.imported === 'default' ? head : binding.imported;
  return [...(module === undefined ? [] : [module]), imported, ...rest].join('.');
};

type Judged = {
  readonly reading: Reading;
  readonly seat: Seat;
  readonly facts: Outline;
  readonly one: Declared;
  readonly words: readonly string[];
  readonly extends: string | undefined;
  readonly exported: boolean;
};

const nameKey = ({ seat, one }: Judged): string => `${seat.local}#${one.name}`;

const isService = (judged: Judged): boolean =>
  judged.one.kind === 'class' && judged.extends !== undefined && judged.reading.params.services.includes(judged.extends);

const lengthSignals = (judged: Judged): void => {
  const { reading, seat, one, words } = judged;
  const { S1, S2, S3, S5 } = reading.params.checks;
  const path = seat.path;
  const last = words.at(-1) ?? '';
  if (S1 !== undefined && words.length >= S1.words && !covered(S1.exempt, seat.local)) {
    report(reading, {
      rule: 'S1',
      key: nameKey(judged),
      path,
      line: one.line,
      message: `\`${one.name}\` has ${words.length} words`,
      fix: `Name \`${one.name}\` in fewer than ${S1.words} words: drop what its module, file or owner already says, or move it to the owner whose name carries the rest.`,
      value: words.length,
    });
  }
  if (S2 !== undefined && !covered(S2.exempt, seat.local)) {
    const rest = one.name.slice(S2.prefix.length);
    if (one.name.startsWith(S2.prefix) && /^[A-Z]/.test(rest)) {
      const kernel = (specifier: string) => S2.kernel.some((door) => specifier === door || specifier.startsWith(`${door}/`));
      const merging = judged.facts.bindings.some(
        (binding) => (binding.local === rest || binding.imported === rest) && kernel(binding.specifier),
      );
      if (!merging)
        report(reading, {
          rule: 'S2',
          key: nameKey(judged),
          path,
          line: one.line,
          message: `\`${one.name}\` opens with \`${S2.prefix}\``,
          fix: `Rename it \`${rest}\`, without the product prefix \`${S2.prefix}\`.`,
        });
    }
  }
  if (S3 !== undefined && isService(judged) && S3.suffixes.some((suffix) => sameText(suffix, last)) && !covered(S3.exempt, seat.local)) {
    report(reading, {
      rule: 'S3',
      key: nameKey(judged),
      path,
      line: one.line,
      message: `the service key \`${one.name}\` ends in \`${last}\``,
      fix: `Name the key by the subject it serves, without \`${last}\`.`,
    });
  }
  if (S5 !== undefined && S5.heads.some((head) => sameText(head, last)) && !covered(S5.exempt, seat.local)) {
    const allowed = S5.allows.some((allow) => sameText(allow.head, last) && covered(allow.in, seat.local));
    if (!allowed)
      report(reading, {
        rule: 'S5',
        key: nameKey(judged),
        path,
        line: one.line,
        message: `\`${one.name}\` ends in the generic \`${last}\``,
        fix: `Name \`${one.name}\` by what it is, without the generic \`${last}\`.`,
      });
  }
};

const memberSignals = (judged: Judged): void => {
  const { reading, seat, one, words } = judged;
  const { S6 } = reading.params.checks;
  if (S6 === undefined || one.members === undefined || (one.kind !== 'class' && one.kind !== 'interface') || covered(S6.exempt, seat.local))
    return;
  const owners = [words[0], wordsOf(stemOf(seat.local))[0]].filter((word): word is string => word !== undefined);
  for (const member of new Set(one.members)) {
    const repeated = wordsOf(member).find((word) => owners.some((owner) => sameWord(word, owner)));
    if (repeated === undefined) continue;
    report(reading, {
      rule: 'S6',
      key: `${seat.local}#${one.name}.${member}`,
      path: seat.path,
      line: one.line,
      message: `\`${one.name}.${member}\` repeats \`${repeated}\``,
      fix: `Rename \`${member}\` without \`${repeated}\`: its owner \`${one.name}\` already says it.`,
    });
  }
};

type Glossed = { readonly retired: readonly (Retired & { readonly matcher?: RegExp })[]; readonly reserved: readonly Term[] };

const glossedAt = (reading: Reading, seat: Seat): Glossed => {
  const { S7a, S7b } = reading.params.checks;
  const { glossary } = reading.params;
  return {
    retired:
      S7a === undefined || covered(S7a.exempt, seat.local)
        ? []
        : glossary.flatMap((term) =>
            term.retired
              .filter((gone) => covered(gone.regions, seat.local) && !covered(gone.exempt.paths, seat.local))
              .map((gone) => (gone.pattern === undefined ? gone : { ...gone, matcher: new RegExp(gone.pattern) })),
          ),
    reserved:
      S7b === undefined || covered(S7b.exempt, seat.local)
        ? []
        : glossary.filter((term) => term.reserved && !covered(term.regions, seat.local)),
  };
};

const retiredIn = (gone: Glossed['retired'][number], name: string, words: readonly string[]): boolean => {
  if (gone.matcher !== undefined) return gone.matcher.test(name);
  const spelling = gone.spelling ?? '';
  const at = gone.at === 'first' ? words.slice(0, 1) : gone.at === 'last' ? words.slice(-1) : words;
  return at.some((word) => sameWord(word, spelling));
};

const glossarySignals = (judged: Judged, glossed: Glossed): void => {
  const { reading, seat, one, words } = judged;
  const path = seat.path;
  for (const gone of glossed.retired) {
    if (gone.exempt.names.includes(one.name) || (gone.kinds.length > 0 && !gone.kinds.includes(one.kind))) continue;
    if (!retiredIn(gone, one.name, words)) continue;
    const spelled = gone.spelling ?? gone.pattern ?? '';
    report(reading, {
      rule: 'S7a',
      key: `${seat.local}#${one.name}:${spelled}`,
      path,
      line: one.line,
      message: `\`${one.name}\` carries the retired \`${spelled}\` (${gone.sense})`,
      fix: `Rename \`${one.name}\` by the glossary, where \`${spelled}\` gives way to ${gone.replacement}.`,
    });
  }
  for (const term of glossed.reserved) {
    if (!words.some((word) => sameWord(word, term.word))) continue;
    report(reading, {
      rule: 'S7b',
      key: `${seat.local}#${one.name}:${term.word}`,
      path,
      line: one.line,
      message: `\`${one.name}\` carries \`${term.word}\`, reserved to ${term.owner}`,
      fix: `Rename \`${one.name}\` without \`${term.word}\`, or move it into ${term.owner}'s regions${term.regions.length === 0 ? '' : ` (${term.regions.map((one) => `\`${one}\``).join(', ')})`}.`,
    });
  }
};

const ROWS: ReadonlySet<string> = new Set(['$inferSelect', '$inferInsert']);

const SCHEMA_SIDES: ReadonlySet<string> = new Set(['Type', 'Encoded']);

const RECORD_SCHEMAS: ReadonlySet<string> = new Set(['Schema.Struct', 'Schema.TaggedStruct']);

const TYPE_KEEPING_PIPES: ReadonlySet<string> = new Set(['Schema.toTaggedUnion']);

type Aliased = { readonly records: number; readonly unread: readonly string[] };

const schemaRecords = (made: Made, bindings: readonly Binding[]): { readonly records: number; readonly whole: boolean } => {
  if (made.pipes.some((pipe) => !TYPE_KEEPING_PIPES.has(heritage(pipe, bindings) ?? ''))) return { records: 0, whole: false };
  const callee = heritage(made.callee, bindings) ?? '';
  if (RECORD_SCHEMAS.has(callee)) return { records: 1, whole: true };
  if (callee !== 'Schema.Union') return { records: 0, whole: false };
  const arms = made.arms.map((arm) => (arm === undefined ? { records: 0, whole: false } : schemaRecords(arm, bindings)));
  return { records: arms.reduce((sum, arm) => sum + arm.records, 0), whole: arms.every((arm) => arm.whole) };
};

const aliasedOf = (union: Union, bindings: readonly Binding[]): Aliased => {
  let records = union.records;
  const unread: string[] =
    union.other > 0
      ? [
          `${union.other} member${union.other === 1 ? '' : 's'} written as an index, a \`typeof\` or a computed type the reader does not read`,
        ]
      : [];
  for (const query of union.queries) {
    const read = `\`typeof ${query.of}.${query.member}\``;
    if (ROWS.has(query.member)) {
      records += 1;
      continue;
    }
    const made =
      SCHEMA_SIDES.has(query.member) && query.made !== undefined ? schemaRecords(query.made, bindings) : { records: 0, whole: false };
    records += made.records;
    if (!made.whole) unread.push(`${read}, whose value this file does not build from a schema the reader knows`);
  }
  return { records, unread };
};

const failureSignals = (judged: Judged): void => {
  const { reading, seat, one, words } = judged;
  const { S8 } = reading.params.checks;
  if (
    S8 === undefined ||
    S8.names.includes(one.name) ||
    S8.notJudged?.some(({ path, name }) => path === seat.local && name === one.name) ||
    covered(S8.exempt, seat.local)
  )
    return;
  const last = words.at(-1) ?? '';
  const defect = (form: string, message: string, fix: string) =>
    report(reading, {
      rule: 'S8',
      key: `${nameKey(judged)}:${form}`,
      path: seat.path,
      line: one.line,
      message: `\`${one.name}\` ${message}`,
      fix,
    });
  const conditions = S8.conditions.map((condition) => `\`${condition}\``).join(', ');
  const unread = (form: string, why: readonly string[]) =>
    reading.unjudged.push({ file: seat.path, line: one.line, specifier: `S8 ${one.name}: a \`…${form}\` holding ${why.join('; ')}` });
  const aliased = one.kind === 'type' && one.union !== undefined ? aliasedOf(one.union, judged.facts.bindings) : undefined;
  const failure = one.kind === 'class' && judged.extends !== undefined && reading.params.errors.includes(judged.extends);
  if (failure && !S8.conditions.some((condition) => sameText(condition, last)))
    defect(
      'condition',
      `is a failure class ending in \`${last}\`, no condition word`,
      `Rename it to end in the condition it reports: one of ${conditions}.`,
    );
  if (failure && one.tag !== undefined && one.tag !== one.name)
    defect('tag', `has the \`_tag\` \`${one.tag}\`, not its name`, `Set its \`_tag\` to \`${one.name}\`.`);
  if (last === 'Failure' && (one.kind === 'class' || one.kind === 'interface'))
    defect(
      'union',
      'is a `…Failure`, a union, and never a class',
      `Make \`${one.name}\` a type union of its failure classes, and name each class by its condition (${conditions}).`,
    );
  if (last === 'Failure' && aliased !== undefined) {
    if (aliased.records > 0)
      defect(
        'union',
        'is a `…Failure` holding an object type, where a `…Failure` is a union of failures',
        `Give each object type a failure class of its own, named by its condition (${conditions}), and keep \`${one.name}\` the union of them.`,
      );
    else if (aliased.unread.length > 0) unread('Failure', aliased.unread);
  }
  if (last === 'Failed' && one.kind === 'type')
    defect(
      'class',
      'is a `…Failed`, a class, and never a type alias',
      `Declare \`${one.name}\` as a failure class extending \`${reading.params.errors[0]}\`.`,
    );
  if (last === 'Refusal' && (one.kind === 'class' || one.kind === 'interface'))
    defect(
      'union',
      'is a `…Refusal`, a union, and never a class',
      `Make \`${one.name}\` a union of string literals or of \`…Refusal\`/\`…Refused\` types.`,
    );
  if (last === 'Refusal' && aliased !== undefined && one.union !== undefined) {
    const foreign = one.union.references.filter((reference) => !['Refusal', 'Refused'].includes(lastWord(reference)));
    const held = [...(aliased.records > 0 ? ['an object type'] : []), ...foreign.map((reference) => `\`${reference}\``)];
    if (held.length > 0)
      defect(
        'union',
        `holds ${held.join(', ')}, where a \`…Refusal\` holds only string literals and \`…Refusal\`/\`…Refused\` types`,
        `Replace ${held.join(', ')} in \`${one.name}\` with string literals or \`…Refused\` types.`,
      );
    else if (aliased.unread.length > 0) unread('Refusal', aliased.unread);
  }
};

const applicationShape = (judged: Judged, name: string): boolean => {
  const { facts } = judged;
  const [head = name, ...rest] = name.split('.');
  const binding = facts.bindings.find((one) => one.local === head);
  if (rest.length > 0) return binding !== undefined && binding.imported === '*' && binding.specifier.startsWith('.');
  if ([...facts.exports, ...facts.locals].some((one) => one.name === name && TYPED.has(one.kind))) return true;
  return binding !== undefined && binding.specifier.startsWith('.');
};

const genericContract = (judged: Judged, name: string): boolean => {
  const { reading, seat } = judged;
  const held = reading
    .declaring(name)
    .filter((path) => reading.seat(path).module === seat.module)
    .flatMap((path) =>
      reading.facts(path).exports.filter((other) => other.name === name && (other.kind === 'type' || other.kind === 'interface')),
    );
  return held.length === 1 && held[0]?.generic === true;
};

const serviceIds = (
  facts: Outline,
): readonly { readonly name: string; readonly tag: string | undefined; readonly extends: string | undefined }[] =>
  [...facts.exports, ...facts.locals].flatMap((one) =>
    one.kind === 'class' ? [{ name: one.name, tag: one.tag, extends: heritage(one.extends, facts.bindings) }] : [],
  );

export const serviceKeys = (facts: Outline, services: readonly string[]) =>
  serviceIds(facts).filter((key) => key.tag !== undefined && key.extends !== undefined && services.includes(key.extends));

const sharedWith = (judged: Judged, id: string): readonly string[] => {
  const { reading, seat, one } = judged;
  return reading.keying(id).filter((path) => {
    const keys = serviceKeys(reading.facts(path), reading.params.services).filter((key) => key.tag === id);
    return (path === seat.path ? keys.filter((key) => key.name !== one.name) : keys).length > 0;
  });
};

const contractSignals = (judged: Judged, shapes: ReadonlySet<string>): void => {
  const { reading, seat, facts, one, words } = judged;
  const { S9, S10 } = reading.params.checks;
  const service = isService(judged);
  const last = words.at(-1) ?? '';
  if (S9 !== undefined && !covered(S9.exempt, seat.local)) {
    const defect = (form: string, message: string, fix: string) =>
      report(reading, {
        rule: 'S9',
        key: `${nameKey(judged)}:${form}`,
        path: seat.path,
        line: one.line,
        message: `the service key \`${one.name}\` ${message}`,
        fix,
      });
    if (service) {
      const expected = S9.id.replaceAll('{module}', seat.module).replaceAll('{name}', one.name);
      if (one.tag === undefined) defect('id', 'names no id', `Give it the id \`${expected}\`.`);
      else if (one.tag !== expected) defect('id', `holds the id \`${one.tag}\`, not \`${expected}\``, `Change its id to \`${expected}\`.`);
      if (one.tag !== undefined) {
        const holders = sharedWith(judged, one.tag);
        if (holders.length > 0)
          defect(
            'shared',
            `shares its id \`${one.tag}\` with ${holders.map((path) => `\`${reading.seat(path).local}\``).join(', ')}`,
            'Keep one key per id: merge the keys that share it, or give each its own id by the template.',
          );
      }
      if (S9.suffixes.some((suffix) => sameText(suffix, last)))
        defect('suffix', `ends in \`${last}\``, `Name the key by the subject it serves, without \`${last}\`.`);
      if (
        one.shape?.written === 'named' &&
        applicationShape(judged, one.shape.name) &&
        !(one.shape.arguments > 0 && genericContract(judged, one.shape.name))
      ) {
        defect(
          'shape',
          `names its shape \`${one.shape.name}\`, an application type, where the shape is written inline`,
          `Write the shape inline in the key's declaration in place of \`${one.shape.name}\`.`,
        );
      }
    } else if (one.kind === 'class' && judged.exported && !covered(S9.testing, seat.local)) {
      const shape = one.implements?.find(
        (clause) => heritage(clause, facts.bindings) === 'Context.Service.Shape' || /Faces?$/.test(clause) || shapes.has(clause),
      );
      if (shape !== undefined)
        defect(
          'implements',
          `is implemented by the exported \`${one.name}\` through \`${shape}\``,
          `Build the service inside its layer instead of an exported class implementing \`${shape}\`${S9.testing.length === 0 ? '' : `; a test double moves under ${S9.testing.map((glob) => `\`${glob}\``).join(', ')}`}.`,
        );
    }
  }
  if (S10 === undefined || !service || covered(S10.exempt, seat.local)) return;
  const { shape } = one;
  const members =
    shape?.written === 'inline'
      ? shape.members
      : shape?.written === 'named'
        ? [...facts.exports, ...facts.locals].find(
            (other) => other.name === shape.name && other.members !== undefined && other.kind !== 'class',
          )?.members
        : undefined;
  if (members === undefined) return;
  const verbs = new Set(S10.verbs.map((verb) => verb.toLowerCase()));
  const nouns = new Set(
    members
      .flatMap((member) => wordsOf(member))
      .filter((word) => !verbs.has(word.toLowerCase()) && !words.some((own) => sameWord(own, word)))
      .map(canonicalWord),
  );
  if (nouns.size < S10.nouns) return;
  report(reading, {
    rule: 'S10',
    key: nameKey(judged),
    path: seat.path,
    line: one.line,
    message: `\`${one.name}\`'s members carry ${nouns.size} other words: ${[...nouns].sort().join(', ')}`,
    fix: `Split \`${one.name}\` by subject: each key holds one subject, so its members carry fewer than ${S10.nouns} words besides its own name and the verbs.`,
    value: nouns.size,
  });
};

const eventSignals = (reading: Reading, seat: Seat, facts: Outline): void => {
  const { S11 } = reading.params.checks;
  if (S11 === undefined || covered(S11.exempt, seat.local)) return;
  const participle = (name: string) => {
    const last = lastWord(name);
    return /ed$/i.test(last) || S11.participles.some((one) => sameText(one, last));
  };
  const seen = new Set<string>();
  const signal = (name: string, line: number, why: string) => {
    if (name.length < 2 || participle(name) || seen.has(name)) return;
    seen.add(name);
    report(reading, {
      rule: 'S11',
      key: `${seat.local}#${name}`,
      path: seat.path,
      line,
      message: `\`${name}\` ${why}, and its last word is no past participle`,
      fix: `Rename \`${name}\` to end in the past participle of what happened, as \`ThreadStarted\`.`,
    });
  };
  for (const one of facts.published) signal(one.name, one.line, 'is published');
  for (const one of facts.exports) {
    if (one.kind !== 'type' || !/^Events?$/.test(lastWord(one.name)) || one.union === undefined) continue;
    for (const reference of one.union.references) signal(reference, one.line, `is an arm of \`${one.name}\``);
  }
};

export const symbolSignals = (reading: Reading, path: string): void => {
  const { checks, glossary } = reading.params;
  const symbolic = [checks.S1, checks.S2, checks.S3, checks.S5, checks.S6, checks.S8, checks.S9, checks.S10, checks.S11].some(
    (one) => one !== undefined,
  );
  const glossing = (checks.S7a !== undefined || checks.S7b !== undefined) && glossary.length > 0;
  if (!symbolic && !glossing) return;
  const seat = reading.seat(path);
  const facts = reading.facts(path);
  const shapes = new Set(
    [...facts.exports, ...facts.locals].flatMap((one) =>
      one.shape?.written === 'named' && reading.params.services.includes(heritage(one.extends, facts.bindings) ?? '')
        ? [one.shape.name]
        : [],
    ),
  );
  const glossed = glossedAt(reading, seat);
  const judgedOf = (one: Declared, exported: boolean): Judged => ({
    reading,
    seat,
    facts,
    one,
    words: wordsOf(one.name),
    extends: heritage(one.extends, facts.bindings),
    exported,
  });
  for (const one of facts.exports) {
    const judged = judgedOf(one, true);
    lengthSignals(judged);
    memberSignals(judged);
    glossarySignals(judged, glossed);
    failureSignals(judged);
    contractSignals(judged, shapes);
  }
  for (const one of facts.locals) {
    const judged = judgedOf(one, false);
    if (isService(judged)) contractSignals(judged, shapes);
  }
  eventSignals(reading, seat, facts);
};

export const typedNames = (facts: Outline): ReadonlySet<string> =>
  new Set(facts.exports.filter(({ kind }) => TYPED.has(kind)).map(({ name }) => name));

export const typeSignals = (reading: Reading, paths: readonly string[]): void => {
  const { S4 } = reading.params.checks;
  if (S4 === undefined || paths.length === 0) return;
  const judged = paths.filter((path) => !covered(S4.exempt, reading.seat(path).local));
  if (judged.length === 0) return;
  const listed = reading.listed();
  if (listed === undefined) {
    for (const path of judged) reading.unjudged.push({ file: path, line: 1, specifier: 'S4: the tree lists no paths' });
    return;
  }
  for (const path of judged) {
    const seat = reading.seat(path);
    const facts = reading.facts(path);
    for (const name of typedNames(facts)) {
      const others = reading.declaring(name).filter((other) => other !== path && !covered(S4.exempt, reading.seat(other).local));
      const clashing =
        S4.within === 'module'
          ? others.filter((other) => reading.seat(other).module === seat.module)
          : others.filter((other) => reading.seat(other).module !== seat.module);
      if (clashing.length === 0) continue;
      const line = facts.exports.find((one) => one.name === name && TYPED.has(one.kind))?.line ?? 1;
      const key = S4.within === 'module' ? `${seat.module}:${name} @ ${seat.local}` : `${name} @ ${seat.local}`;
      report(reading, {
        rule: 'S4',
        key,
        path,
        line,
        message: `\`${name}\` is also declared in ${clashing.map((one) => `\`${reading.seat(one).local}\``).join(', ')}`,
        fix: `Declare \`${name}\` once, in the lowest ${S4.within === 'module' ? 'file' : 'module'} that uses it, and import it from there; a different concept takes a name of its own.`,
      });
    }
  }
};
