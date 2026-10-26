import { isKeyword, isMark, nameOf, pastGroup, tokenize } from './statementTarget.js';

export type ColumnShape = {
  readonly columns: ReadonlySet<string>;
  readonly collations: ReadonlyMap<string, string>;
  readonly generated: ReadonlyMap<string, ReadonlySet<string>>;
  readonly replacing: readonly ReadonlySet<string>[];
};

const CONSTRAINTS = ['constraint', 'primary', 'unique', 'foreign', 'check'];

export const columnShape = (definition: string): ColumnShape => {
  const tokens = tokenize(definition);
  const begin = tokens.findIndex((token) => isMark(token, '('));
  const end = begin === -1 ? 0 : pastGroup(tokens, begin) - 1;
  const parts: ReturnType<typeof tokenize>[] = [];
  let from = begin + 1;
  for (let at = from; at <= end; at += 1) {
    if (at === end || isMark(tokens[at], ',')) {
      parts.push(tokens.slice(from, at));
      from = at + 1;
    } else if (isMark(tokens[at], '(')) at = pastGroup(tokens, at) - 1;
  }
  const named = (token: (typeof tokens)[number] | undefined): string | null => {
    const name = nameOf(token);
    if (name !== null) return name.toLowerCase();
    return token !== undefined && 'mark' in token && token.mark === "'"
      ? definition
          .slice(token.start + 1, token.end - 1)
          .replaceAll("''", "'")
          .toLowerCase()
      : null;
  };
  const declared = parts.filter((part) => !CONSTRAINTS.some((word) => isKeyword(part[0], word)));
  const columns = new Set(declared.flatMap((part) => named(part[0]) ?? []));
  const collations = new Map<string, string>();
  const generated = new Map<string, ReadonlySet<string>>();
  const replacing: ReadonlySet<string>[] = [];
  for (const part of parts) {
    const column = CONSTRAINTS.some((word) => isKeyword(part[0], word)) ? null : named(part[0]);
    let unique = false;
    let constrained: ReadonlySet<string> = column === null ? new Set() : new Set([column]);
    for (let at = column === null ? 0 : 1; at < part.length; at += 1) {
      if (isKeyword(part[at], 'unique') || (isKeyword(part[at], 'primary') && isKeyword(part[at + 1], 'key'))) {
        unique = true;
        const group = at + (isKeyword(part[at], 'unique') ? 1 : 2);
        if (column === null && isMark(part[group], '(')) {
          const past = pastGroup(part, group);
          constrained = new Set(
            part.slice(group + 1, past - 1).flatMap((token) => {
              const name = named(token);
              return name !== null && columns.has(name) ? [name] : [];
            }),
          );
        }
      }
      if (unique && isKeyword(part[at], 'on') && isKeyword(part[at + 1], 'conflict') && isKeyword(part[at + 2], 'replace'))
        replacing.push(constrained);
      if (['not', 'check', 'references', 'generated', 'default'].some((word) => isKeyword(part[at], word))) unique = false;
      if (column !== null && isKeyword(part[at], 'collate')) collations.set(column, named(part[at + 1]) ?? 'binary');
      if (column !== null && isKeyword(part[at], 'as') && isMark(part[at + 1], '(')) {
        const past = pastGroup(part, at + 1);
        generated.set(
          column,
          new Set(
            part.slice(at + 2, past - 1).flatMap((token, index, expression) => {
              const name = nameOf(token)?.toLowerCase();
              return name !== undefined &&
                columns.has(name) &&
                !isMark(expression[index + 1], '(') &&
                !isKeyword(expression[index - 1], 'collate') &&
                !isKeyword(expression[index - 1], 'as')
                ? [name]
                : [];
            }),
          ),
        );
      }
      if (isMark(part[at], '(')) at = pastGroup(part, at) - 1;
    }
  }
  return { columns, collations, generated, replacing };
};
