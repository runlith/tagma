import type { ExportKind, Facts, Forward, Import, ShapeKind, Use } from './facts';

export type Packed = readonly [
  exports: readonly (readonly [string, ExportKind, number])[],
  imports: readonly (readonly string[])[],
  forwards: readonly (readonly string[])[],
  loads: readonly (readonly [string, 0 | 1])[],
  uses: readonly Use[],
  shapes: readonly (readonly [ShapeKind, string, number, number, 0 | 1, string, string, string, 0 | 1])[],
];

const bound = (imported: string, local: string): string => (imported === local ? imported : `${imported}>${local}`);

const unbound = (text: string): readonly [imported: string, local: string] => {
  const at = text.indexOf('>');
  return at < 0 ? [text, text] : [text.slice(0, at), text.slice(at + 1)];
};

const TYPED = '~';

export const pack = (facts: Facts): Packed => [
  facts.exports.map((one) => [one.name, one.kind, one.line]),
  facts.imports.map((one) => [one.specifier, ...one.bindings.map((binding) => bound(binding.imported, binding.local))]),
  facts.forwards.map((one) => [
    one.specifier,
    ...(one.names === 'all'
      ? [one.typed === true ? `${TYPED}*` : '*']
      : one.names.map((name) => `${one.typed === true || name.typed === true ? TYPED : ''}${bound(name.imported, name.exported)}`)),
  ]),
  facts.loads.map((one) => [one.specifier, one.pattern ? 1 : 0]),
  facts.uses,
  facts.shapes.map((one) => [
    one.kind,
    one.name,
    one.line,
    one.size,
    one.exported ? 1 : 0,
    one.key,
    one.label,
    one.text ?? '',
    one.declaration ? 1 : 0,
  ]),
];

export const unpack = (packed: Packed): Facts => ({
  exports: packed[0].map(([name, kind, line]) => ({ name, kind, line })),
  imports: packed[1].map(([specifier, ...rest]): Import => ({
    specifier: specifier!,
    bindings: rest.map((one) => {
      const [imported, local] = unbound(one);
      return { local, imported };
    }),
  })),
  forwards: packed[2].map(([specifier, ...rest]): Forward =>
    rest.length === 1 && (rest[0] === '*' || rest[0] === `${TYPED}*`)
      ? { specifier: specifier!, names: 'all', ...(rest[0] === '*' ? {} : { typed: true as const }) }
      : {
          specifier: specifier!,
          names: rest.map((one) => {
            const typed = one.startsWith(TYPED);
            const [imported, exported] = unbound(typed ? one.slice(TYPED.length) : one);
            return typed ? { imported, exported, typed: true as const } : { imported, exported };
          }),
        },
  ),
  loads: packed[3].map(([specifier, pattern]) => ({ specifier, pattern: pattern === 1 })),
  uses: packed[4],
  shapes: packed[5].map(([kind, name, line, size, exported, key, label, text, declaration]) => ({
    kind,
    name,
    line,
    size,
    exported: exported === 1,
    declaration: declaration === 1,
    key,
    label,
    ...(text === '' ? {} : { text }),
  })),
});
