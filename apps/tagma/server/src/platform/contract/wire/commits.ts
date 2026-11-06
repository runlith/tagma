export type Person = { readonly name: string; readonly email: string };

export const AGENT_PERSON: Person = { name: 'Tagma', email: 'agent@tagma.app' };

export const personOf = (person: Person): string => `${person.name} <${person.email}>`;

export type Trailer = readonly [key: string, value: string];

const TRAILER = /^[A-Za-z0-9][A-Za-z0-9-]*[ \t]*:/u;
const CONTINUATION = /^[ \t]+\S/u;
const COMMENT = /^#/u;

export const trailed = (message: string, trailers: readonly Trailer[]): string => {
  const text = message.trimEnd();
  const lines = text.split(/\r?\n/u);
  let start = lines.length;
  while (start > 0 && lines[start - 1]?.trim() !== '') start -= 1;
  const last = lines.slice(start);
  const joins =
    start > 1 &&
    last.some((line) => TRAILER.test(line)) &&
    last.every((line, at) => TRAILER.test(line) || COMMENT.test(line) || (at > 0 && CONTINUATION.test(line)));
  const standing = new Set(joins ? last : []);
  const added = [
    ...new Set(trailers.map(([key, value]) => `${key}: ${value.replace(/\s+/gu, ' ').trim()}`).filter((line) => !standing.has(line))),
  ];
  if (added.length === 0) return message;
  return `${text}${joins ? '\n' : '\n\n'}${added.join('\n')}`;
};
