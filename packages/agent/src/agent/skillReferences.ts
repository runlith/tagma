export type SkillReference = {
  readonly id: string;
  readonly from: number;
  readonly to: number;
};

export type SkillQuery = {
  readonly query: string;
  readonly from: number;
  readonly to: number;
};

export function skillReference(id: string): string {
  return `$${/^[a-z][a-z0-9-]*$/.test(id) ? id : JSON.stringify(id)}`;
}

export type SkillInsertion = { readonly text: string; readonly skip: number };

export function skillInsertion(id: string, suffix: string): SkillInsertion {
  const closed = suffix.length > 0 && /^[\s.,;:!?()[\]{}]/.test(suffix);
  return { text: `${skillReference(id)}${closed ? '' : ' '}`, skip: suffix.startsWith(' ') ? 1 : 0 };
}

export function skillArguments(text: string, id: string): string {
  let rest = text;
  for (const reference of skillReferences(text).toReversed()) {
    if (reference.id !== id) continue;
    rest = rest.slice(0, reference.from) + rest.slice(reference.to + (rest[reference.to] === ' ' ? 1 : 0));
  }
  return rest.trim();
}

export function skillReferences(text: string): readonly SkillReference[] {
  return [...tokens(text)].filter((token) => token.closed && token.id.length > 0).map(({ id, from, to }) => ({ id, from, to }));
}

export function skillQuery(text: string, from: number, to: number): SkillQuery | null {
  if (from !== to || from < 0 || from > text.length) return null;
  for (const token of tokens(text)) {
    if (from > token.from && from <= token.to) {
      const query = token.quoted
        ? quotedId(`"${text.slice(token.from + 2, Math.min(from, token.to - (token.closed ? 1 : 0)))}"`)
        : text.slice(token.from + 1, from);
      return query === null ? null : { query, from: token.from, to: token.to };
    }
  }
  return null;
}

type Token = SkillReference & { readonly quoted: boolean; readonly closed: boolean };

function quotedId(source: string): string | null {
  try {
    const value: unknown = JSON.parse(source);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function* tokens(text: string): Generator<Token> {
  let fence: { marker: string; length: number } | undefined;
  let ticks = 0;
  let opaqueUntil = 0;
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(start, end);
    const marker = start < opaqueUntil ? null : /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1]![0] === fence.marker && marker[1]!.length >= fence.length && marker[2]!.trim() === '') {
        fence = undefined;
      }
    } else if (ticks === 0 && marker) {
      fence = { marker: marker[1]![0]!, length: marker[1]!.length };
    } else {
      let cursor = start;
      while (cursor < end) {
        if (cursor < opaqueUntil) {
          cursor = Math.min(opaqueUntil, end);
          continue;
        }
        const character = text[cursor]!;
        if (character === '\\' && ticks === 0) {
          cursor += 2;
          continue;
        }
        if (character === '`') {
          let after = cursor + 1;
          while (after < end && text[after] === '`') after += 1;
          const length = after - cursor;
          if (ticks === 0) ticks = length;
          else if (length === ticks) ticks = 0;
          cursor = after;
          continue;
        }
        if (ticks === 0 && character === '[' && text[cursor + 1] === '[') {
          const close = text.indexOf(']]', cursor + 2);
          opaqueUntil = close === -1 ? text.length : close + 2;
          continue;
        }
        if (ticks > 0 || character !== '$' || (cursor > 0 && !/\s/.test(text[cursor - 1]!))) {
          cursor += 1;
          continue;
        }
        const from = cursor;
        cursor += 1;
        if (text[cursor] === '"') {
          cursor += 1;
          while (cursor < end && text[cursor] !== '"') cursor += text[cursor] === '\\' ? 2 : 1;
          const closed = cursor < end;
          cursor = closed ? cursor + 1 : end;
          if (!closed || cursor === text.length || /[\s.,;:!?()[\]{}]/.test(text[cursor]!)) {
            yield { id: closed ? (quotedId(text.slice(from + 1, cursor)) ?? '') : '', from, to: cursor, quoted: true, closed };
          }
          continue;
        }
        if (cursor < end && /[a-z]/.test(text[cursor]!)) {
          cursor += 1;
          while (cursor < end && /[a-z0-9-]/.test(text[cursor]!)) cursor += 1;
        }
        if (cursor === text.length || /[\s.,;:!?()[\]{}]/.test(text[cursor]!)) {
          yield { id: text.slice(from + 1, cursor), from, to: cursor, quoted: false, closed: true };
        }
      }
    }
    start = end + 1;
  }
}
