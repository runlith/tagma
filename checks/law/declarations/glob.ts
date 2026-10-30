const ESCAPED = /[.+^$()|[\]\\]/g;

const expression = (pattern: string): string => {
  let out = '';
  let depth = 0;
  for (let at = 0; at < pattern.length; at++) {
    const one = pattern[at]!;
    if (one === '*') {
      if (pattern[at + 1] === '*') {
        at++;
        if (pattern[at + 1] === '/') {
          at++;
          out += '(?:.*/)?';
        } else out += '.*';
      } else out += '[^/]*';
    } else if (one === '?') out += '[^/]';
    else if (one === '{') {
      depth++;
      out += '(?:';
    } else if (one === '}' && depth > 0) {
      depth--;
      out += ')';
    } else if (one === ',' && depth > 0) out += '|';
    else out += one.replace(ESCAPED, '\\$&');
  }
  return out;
};

export const globRegex = (pattern: string): RegExp => new RegExp(`^${expression(pattern)}$`);

export const matcher = (patterns: readonly string[]): ((path: string) => boolean) => {
  if (patterns.length === 0) return () => false;
  const regex = new RegExp(`^(?:${patterns.map(expression).join('|')})$`);
  return (path) => regex.test(path);
};
