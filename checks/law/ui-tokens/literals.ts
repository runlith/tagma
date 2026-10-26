export type Literal = {
  readonly text: string;
  readonly line: number;
  readonly classes: boolean;
  readonly style: boolean;
  readonly attribute: string;
};

export type IconTag = { readonly name: string; readonly line: number; readonly literals: readonly Literal[] };

export type Source = {
  readonly literals: readonly Literal[];
  readonly styles: readonly { readonly text: string; readonly line: number }[];
  readonly icons: readonly IconTag[];
};

type Context = { readonly classes: boolean; readonly keys: boolean; readonly style: boolean; readonly attribute: string };

const PLAIN: Context = { classes: false, keys: false, style: false, attribute: '' };

const CLASS_CALLS: ReadonlySet<string> = new Set(['cn', 'clsx', 'cva', 'tv', 'twMerge', 'twJoin', 'classNames']);

const KEYED_CALLS: ReadonlySet<string> = new Set(['cn', 'clsx', 'classNames']);

const CLASS_ATTRIBUTE = /class$/i;

const IDENTIFIER = /[A-Za-z_$][\w$]*/y;

const IMPORT = /import\s+(?:type\s+)?([\w$]+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s+['"]([^'"]+)['"]/g;

const NAMESPACE = /import\s+\*\s+as\s+([\w$]+)\s+from\s+['"]([^'"]+)['"]/g;

const ALIAS = /\b(?:const|let)\s+([A-Z][\w$]*)\s*=\s*([A-Z][\w$]*)\s*[;\n]/g;

export const iconNamesOf = (text: string, sources: readonly string[]): ReadonlySet<string> => {
  const names = new Set<string>();
  const from = (specifier: string): boolean => sources.some((source) => specifier.startsWith(source));
  for (const match of text.matchAll(IMPORT)) {
    if (!from(match[3]!)) continue;
    if (match[1] !== undefined) names.add(match[1]);
    for (const part of (match[2] ?? '').split(',')) {
      const bound = part
        .trim()
        .split(/\s+as\s+/)
        .pop()!;
      if (/^[A-Z][\w$]*$/.test(bound)) names.add(bound);
    }
  }
  for (const match of text.matchAll(NAMESPACE)) if (from(match[2]!)) names.add(`${match[1]}.*`);
  for (const match of text.matchAll(ALIAS)) if (names.has(match[2]!)) names.add(match[1]!);
  return names;
};

const iconNamed = (icons: ReadonlySet<string>, name: string): boolean =>
  icons.has(name) || (name.includes('.') && icons.has(`${name.slice(0, name.indexOf('.'))}.*`));

export const sourceOf = (text: string, svelte: boolean, icons: ReadonlySet<string>): Source => {
  const literals: Literal[] = [];
  const styles: { text: string; line: number }[] = [];
  const iconTags: IconTag[] = [];
  let at = 0;
  let line = 1;
  let limit = text.length;
  let collect: Literal[] | undefined;
  const take = (value: string, from: number, context: Context): void => {
    const held = { text: value, line: from, classes: context.classes, style: context.style, attribute: context.attribute };
    literals.push(held);
    collect?.push(held);
  };
  const step = (): void => {
    if (text[at] === '\n') line++;
    at++;
  };
  const skipTo = (end: string): void => {
    const found = text.indexOf(end, at);
    const to = found < 0 || found >= limit ? limit : found + end.length;
    while (at < to) step();
  };
  const quoted = (quote: string, context: Context, multiline: boolean, prefix: string): void => {
    const from = line;
    let value = '';
    while (at < limit) {
      const c = text[at]!;
      if (c === quote) {
        step();
        take(prefix + value, from, context);
        return;
      }
      if (c === '\n' && !multiline) return;
      if (c === '\\') {
        value += text.slice(at, at + 2);
        step();
        step();
        continue;
      }
      value += c;
      step();
    }
  };
  const template = (context: Context): void => {
    let from = line;
    let value = '';
    while (at < limit) {
      const c = text[at]!;
      if (c === '`') {
        step();
        take(value, from, context);
        return;
      }
      if (c === '\\') {
        value += text.slice(at, at + 2);
        step();
        step();
        continue;
      }
      if (c === '$' && text[at + 1] === '{') {
        take(value, from, context);
        step();
        step();
        code('}', context);
        value = '';
        from = line;
        continue;
      }
      value += c;
      step();
    }
  };
  const code = (closer: '}' | ')' | null, context: Context): void => {
    let braces = 0;
    let parens = 0;
    let previous = '';
    while (at < limit) {
      const c = text[at]!;
      if (c === '/' && text[at + 1] === '/') {
        while (at < limit && text[at] !== '\n') at++;
      } else if (c === '/' && text[at + 1] === '*') skipTo('*/');
      else if (c === '"' || c === "'") {
        step();
        quoted(c, context, false, '');
        previous = c;
      } else if (c === '`') {
        step();
        template(context);
        previous = c;
      } else if (c === '{') {
        braces++;
        step();
        previous = c;
      } else if (c === '}') {
        step();
        if (closer === '}' && braces === 0) return;
        braces--;
        previous = c;
      } else if (c === '(') {
        parens++;
        step();
        previous = c;
      } else if (c === ')') {
        step();
        if (closer === ')' && parens === 0) return;
        parens--;
        previous = c;
      } else if (/[A-Za-z_$]/.test(c) && !/[\w$.]/.test(text[at - 1] ?? ' ')) {
        IDENTIFIER.lastIndex = at;
        const name = IDENTIFIER.exec(text)![0];
        let look = at + name.length;
        while (look < limit && /\s/.test(text[look]!)) look++;
        const next = text[look];
        if (CLASS_CALLS.has(name) && next === '(') {
          while (at <= look) step();
          code(')', { classes: true, keys: KEYED_CALLS.has(name), style: false, attribute: '' });
          previous = ')';
          continue;
        }
        const keyed = next === ':' ? text[look + 1] !== ':' : next === ',' || next === '}';
        if (context.keys && braces > 0 && (previous === '{' || previous === ',') && keyed) take(name, line, context);
        at += name.length;
        previous = 'a';
      } else {
        if (!/\s/.test(c)) previous = c;
        step();
      }
    }
  };
  if (!svelte) {
    code(null, PLAIN);
    return { literals, styles, icons: iconTags };
  }
  const attributeName = (): string => /([\w:-]+)\s*=\s*$/.exec(text.slice(Math.max(0, at - 64), at))?.[1] ?? '';
  const contextOf = (name: string): Context =>
    CLASS_ATTRIBUTE.test(name)
      ? { classes: true, keys: true, style: false, attribute: name }
      : name === 'style' || name.startsWith('style:')
        ? { classes: false, keys: false, style: true, attribute: name }
        : { ...PLAIN, attribute: name };
  const tag = (): void => {
    const name = /^[A-Za-z][\w.:-]*/.exec(text.slice(at + 1, at + 80))?.[0] ?? '';
    const from = line;
    const held: Literal[] = [];
    const icon = iconNamed(icons, name);
    if (icon) collect = held;
    step();
    while (at < limit) {
      const c = text[at]!;
      if (c === '>') {
        step();
        break;
      }
      if (c === '"' || c === "'") {
        const attribute = attributeName();
        step();
        quoted(c, contextOf(attribute), true, attribute.startsWith('style:') ? `${attribute.slice(6)}: ` : '');
      } else if (c === '{') {
        const attribute = attributeName();
        step();
        code('}', contextOf(attribute));
      } else if (c === 'c' && text.startsWith('class:', at) && /\s/.test(text[at - 1] ?? '')) {
        const directive = /^class:([^\s=>/{]+)/.exec(text.slice(at, at + 200))![1]!;
        take(directive, line, { classes: true, keys: false, style: false, attribute: 'class:' });
        for (let skipped = 0; skipped < 'class:'.length + directive.length; skipped++) step();
      } else step();
    }
    collect = undefined;
    if (icon) iconTags.push({ name, line: from, literals: held });
    if (name === 'script' || name === 'style') {
      const closing = `</${name}>`;
      const found = text.indexOf(closing, at);
      const end = found < 0 ? limit : found;
      if (name === 'style') {
        styles.push({ text: text.slice(at, end), line });
        while (at < end) step();
      } else {
        const outer = limit;
        limit = end;
        code(null, PLAIN);
        limit = outer;
      }
    }
  };
  while (at < limit) {
    const c = text[at]!;
    if (c === '<' && text.startsWith('<!--', at)) skipTo('-->');
    else if (c === '<' && /[A-Za-z]/.test(text[at + 1] ?? '')) tag();
    else if (c === '{') {
      step();
      code('}', PLAIN);
    } else step();
  }
  return { literals, styles, icons: iconTags };
};
