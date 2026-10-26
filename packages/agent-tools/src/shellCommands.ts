export type ShellWord = {
  readonly text: string;
  readonly literal: boolean;
};

export type ShellRedirect = {
  readonly fd: number | 'all';
  readonly op: '>' | '>>';
  readonly target: ShellWord | 'descriptor';
};

export type ShellHeredoc = {
  readonly delimiter: string;
  readonly body: string;
  readonly expand: boolean;
};

export type ShellCommand = {
  readonly words: readonly ShellWord[];
  readonly assignments: readonly ShellWord[];
  readonly redirects: readonly ShellRedirect[];
  readonly heredocs: readonly ShellHeredoc[];
  readonly piped: boolean;
};

const RESERVED = new Set([
  'for',
  'while',
  'until',
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'do',
  'done',
  'case',
  'esac',
  'function',
  'select',
  'in',
  '{',
  '}',
  '!',
]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

type Heredoc = { delimiter: string; body: string; expand: boolean };

type Building = {
  words: ShellWord[];
  assignments: ShellWord[];
  redirects: ShellRedirect[];
  heredocs: Heredoc[];
  piped: boolean;
};

function afterDollar(text: string, at: number): number {
  const next = text[at + 1];
  if (next === '(') {
    let depth = 0;
    let i = at + 1;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) return i + 1;
      } else if (ch === "'" || ch === '"') {
        const end = text.indexOf(ch, i + 1);
        if (end === -1) return text.length;
        i = end;
      }
      i += 1;
    }
    return text.length;
  }
  if (next === '{') {
    const end = text.indexOf('}', at + 2);
    return end === -1 ? text.length : end + 1;
  }
  if (next !== undefined && /[A-Za-z_]/.test(next)) {
    let i = at + 1;
    while (i < text.length && /[A-Za-z0-9_]/.test(text[i] as string)) i += 1;
    return i;
  }
  return next === undefined ? at + 1 : at + 2;
}

function afterBacktick(text: string, at: number): number | null {
  const end = text.indexOf('`', at + 1);
  return end === -1 ? null : end + 1;
}

type Quoted = { text: string; literal: boolean; next: number };

function readDoubleQuoted(text: string, at: number): Quoted | null {
  let out = '';
  let literal = true;
  let i = at + 1;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '"') return { text: out, literal, next: i + 1 };
    if (ch === '\\') {
      const after = text[i + 1];
      if (after === undefined) return null;
      if (after === '\n') {
        i += 2;
        continue;
      }
      out += after === '$' || after === '`' || after === '"' || after === '\\' ? after : ch + after;
      i += 2;
      continue;
    }
    if (ch === '$') {
      const end = afterDollar(text, i);
      out += text.slice(i, end);
      literal = false;
      i = end;
      continue;
    }
    if (ch === '`') {
      const end = afterBacktick(text, i);
      if (end === null) return null;
      out += text.slice(i, end);
      literal = false;
      i = end;
      continue;
    }
    out += ch;
    i += 1;
  }
  return null;
}

class Reader {
  private commands: ShellCommand[] = [];
  private current: Building = Reader.empty(false);
  private word = '';
  private started = false;
  private literal = true;
  private pendingRedirect: { fd: number | 'all'; op: '>' | '>>' } | null = null;
  private pendingHeredocs: Heredoc[] = [];
  private failed = false;

  private static empty(piped: boolean): Building {
    return { words: [], assignments: [], redirects: [], heredocs: [], piped };
  }

  constructor(private readonly text: string) {}

  read(): readonly ShellCommand[] | null {
    let i = 0;
    while (i < this.text.length && !this.failed) {
      const ch = this.text[i] as string;
      if (ch === '\\') {
        const after = this.text[i + 1];
        if (after === undefined) return null;
        if (after === '\n') {
          i += 2;
          continue;
        }
        this.take(after, true);
        i += 2;
        continue;
      }
      if (ch === "'") {
        const end = this.text.indexOf("'", i + 1);
        if (end === -1) return null;
        this.takeRun(this.text.slice(i + 1, end), true);
        i = end + 1;
        continue;
      }
      if (ch === '"') {
        const quoted = readDoubleQuoted(this.text, i);
        if (quoted === null) return null;
        this.takeRun(quoted.text, quoted.literal);
        i = quoted.next;
        continue;
      }
      if (ch === '$') {
        const end = afterDollar(this.text, i);
        this.takeRun(this.text.slice(i, end), false);
        i = end;
        continue;
      }
      if (ch === '`') {
        const end = afterBacktick(this.text, i);
        if (end === null) return null;
        this.takeRun(this.text.slice(i, end), false);
        i = end;
        continue;
      }
      if (ch === '#' && !this.started) {
        const line = this.text.indexOf('\n', i);
        i = line === -1 ? this.text.length : line;
        continue;
      }
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.endWord();
        i += 1;
        continue;
      }
      if (ch === '\n') {
        this.endWord();
        i = this.fillHeredocs(i + 1);
        this.endCommand(false);
        continue;
      }
      if (ch === '(' || ch === ')') return null;
      if (ch === ';') {
        this.endWord();
        this.endCommand(false);
        i += 1;
        continue;
      }
      if (ch === '|') {
        this.endWord();
        const double = this.text[i + 1] === '|';
        this.endCommand(!double);
        i += double ? 2 : 1;
        continue;
      }
      if (ch === '&') {
        if (this.text[i + 1] === '>') {
          this.endWord();
          i = this.openRedirect(i + 2, 'all', this.text[i + 2] === '>' ? '>>' : '>');
          continue;
        }
        this.endWord();
        this.endCommand(false);
        i += this.text[i + 1] === '&' ? 2 : 1;
        continue;
      }
      if (ch === '<') {
        this.endWord();
        i = this.openInput(i);
        continue;
      }
      if (ch === '>') {
        const fd = this.takeDescriptor();
        this.endWord();
        i = this.openRedirect(i + 1, fd, this.text[i + 1] === '>' ? '>>' : '>');
        continue;
      }
      this.take(ch, ch !== '*' && ch !== '?' && ch !== '[' && ch !== ']' && ch !== '{' && ch !== '}');
      i += 1;
    }
    if (this.failed) return null;
    this.endWord();
    this.fillHeredocs(this.text.length);
    this.endCommand(false);
    if (this.pendingRedirect !== null) return null;
    return this.commands;
  }

  private takeDescriptor(): number | 'all' {
    if (!this.started || !/^[0-9]+$/.test(this.word)) return 1;
    const fd = Number(this.word);
    this.word = '';
    this.started = false;
    this.literal = true;
    return fd;
  }

  private take(ch: string, literal: boolean): void {
    if (!this.started && ch === '~') literal = false;
    this.word += ch;
    this.started = true;
    if (!literal) this.literal = false;
  }

  private takeRun(run: string, literal: boolean): void {
    this.word += run;
    this.started = true;
    if (!literal) this.literal = false;
  }

  private endWord(): void {
    if (!this.started) return;
    const word: ShellWord = { text: this.word, literal: this.literal };
    this.word = '';
    this.started = false;
    this.literal = true;
    if (this.pendingRedirect !== null) {
      this.current.redirects.push({ ...this.pendingRedirect, target: word });
      this.pendingRedirect = null;
      return;
    }
    if (this.current.words.length === 0 && ASSIGNMENT.test(word.text)) {
      this.current.assignments.push(word);
      return;
    }
    this.current.words.push(word);
  }

  private endCommand(piped: boolean): void {
    if (this.pendingRedirect !== null) {
      this.failed = true;
      return;
    }
    const verb = this.current.words[0];
    if (verb !== undefined && RESERVED.has(verb.text)) {
      this.failed = true;
      return;
    }
    const empty =
      this.current.words.length === 0 &&
      this.current.assignments.length === 0 &&
      this.current.redirects.length === 0 &&
      this.current.heredocs.length === 0;
    if (!empty) this.commands.push(this.current);
    this.current = Reader.empty(piped);
  }

  private openRedirect(at: number, fd: number | 'all', op: '>' | '>>'): number {
    let i = op === '>>' ? at + 1 : at;
    if (this.text[i] === '|') i += 1;
    while (this.text[i] === ' ' || this.text[i] === '\t') i += 1;
    if (this.text[i] === '&') {
      this.current.redirects.push({ fd, op, target: 'descriptor' });
      i += 1;
      while (i < this.text.length && /[0-9-]/.test(this.text[i] as string)) i += 1;
      return i;
    }
    this.pendingRedirect = { fd, op };
    return i;
  }

  private openInput(at: number): number {
    if (this.text[at + 1] === '<' && this.text[at + 2] === '<') return this.skipWord(at + 3);
    if (this.text[at + 1] === '<') {
      let i = at + 2;
      if (this.text[i] === '-') i += 1;
      while (this.text[i] === ' ' || this.text[i] === '\t') i += 1;
      const quote = this.text[i];
      let delimiter = '';
      let expand = true;
      if (quote === "'" || quote === '"') {
        const end = this.text.indexOf(quote, i + 1);
        if (end === -1) {
          this.failed = true;
          return this.text.length;
        }
        delimiter = this.text.slice(i + 1, end);
        expand = false;
        i = end + 1;
      } else {
        const start = i;
        while (i < this.text.length && !/[\s;&|<>]/.test(this.text[i] as string)) i += 1;
        delimiter = this.text.slice(start, i);
      }
      if (delimiter === '') {
        this.failed = true;
        return this.text.length;
      }
      const heredoc: Heredoc = { delimiter, body: '', expand };
      this.current.heredocs.push(heredoc);
      this.pendingHeredocs.push(heredoc);
      return i;
    }
    return this.skipWord(at + 1);
  }

  private skipWord(at: number): number {
    let i = at;
    while (this.text[i] === ' ' || this.text[i] === '\t') i += 1;
    while (i < this.text.length && !/[\s;&|<>]/.test(this.text[i] as string)) i += 1;
    return i;
  }

  private fillHeredocs(at: number): number {
    if (this.pendingHeredocs.length === 0) return at;
    let i = at;
    for (const heredoc of this.pendingHeredocs) {
      const lines: string[] = [];
      let closed = false;
      while (i <= this.text.length && !closed) {
        const end = this.text.indexOf('\n', i);
        const line = this.text.slice(i, end === -1 ? this.text.length : end);
        const step = end === -1 ? this.text.length : end + 1;
        if (line.trimEnd() === heredoc.delimiter || line.trim() === heredoc.delimiter) {
          closed = true;
          i = step;
          break;
        }
        lines.push(line);
        if (end === -1) {
          i = this.text.length;
          break;
        }
        i = step;
      }
      heredoc.body = lines.length === 0 ? '' : `${lines.join('\n')}\n`;
    }
    this.pendingHeredocs = [];
    return i;
  }
}

export function shellCommands(text: string): readonly ShellCommand[] | null {
  return new Reader(text).read();
}
