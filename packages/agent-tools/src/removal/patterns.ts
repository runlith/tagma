import { homedir } from 'node:os';
import { ToolFailed } from '@runlith/agent/tool';
import { Effect } from 'effect';
import type { ParseReturnFiltered } from 'minimatch';
import { pathMatcher } from '../patterns';

export type PathPattern = {
  readonly prefix: string;
  readonly parts: readonly ParseReturnFiltered[];
  readonly directoryOnly: boolean;
};

export type OperandPattern = {
  readonly operand: string;
  readonly patterns: readonly PathPattern[];
  readonly magic: boolean;
};

function syntaxProblem(pattern: string): string | undefined {
  const braces: number[] = [];
  let bracket = -1;
  for (let at = 0; at < pattern.length; at++) {
    const char = pattern[at];
    if (char === '\\') {
      if (++at === pattern.length) return 'A pattern ends with an incomplete escape.';
      continue;
    }
    if (char === '{') braces.push(at);
    if (char === '}') {
      const start = braces.pop();
      if (start === undefined) return 'A pattern has an unmatched closing brace.';
      if (/^[^,{}]*\.\.[^,{}]*$/u.test(pattern.slice(start + 1, at))) return 'Brace ranges are unsupported; use explicit alternatives.';
    }
    if (bracket >= 0) {
      if (char === ']' && at > bracket + 1 && !(at === bracket + 2 && pattern[bracket + 1] === '!')) bracket = -1;
      continue;
    }
    if (char === '[') {
      bracket = at;
      continue;
    }
    if ('?*+@!'.includes(char ?? '') && pattern[at + 1] === '(')
      return 'Extglob is unsupported; use ordinary glob patterns or glob: false.';
  }
  if (bracket >= 0) return 'A pattern has an unclosed character class.';
  if (braces.length !== 0) return 'A pattern has an unclosed brace alternative.';
  return undefined;
}

function hasWildcard(pattern: string): boolean {
  for (let at = 0; at < pattern.length; at++) {
    if (pattern[at] === '\\') {
      at++;
      continue;
    }
    if ('*?['.includes(pattern[at] ?? '')) return true;
  }
  return false;
}

const terminalDot = (name: string, windows: boolean): boolean =>
  /(?:^|\/)\.{1,2}$/u.test((windows ? name.replaceAll('\\', '/') : name).replace(/\/+$/u, ''));

export const removalPatterns = Effect.fnUntraced(function* (
  operands: readonly string[],
  glob: boolean,
  windows: boolean,
): Effect.fn.Return<readonly OperandPattern[], ToolFailed> {
  const plans: OperandPattern[] = [];
  for (const operand of operands) {
    if (!glob) {
      if (terminalDot(operand, windows))
        return yield* new ToolFailed({ code: 'invalid-operand', reason: `rm does not accept a final . or .. operand: ${operand}.` });
      plans.push({
        operand,
        magic: false,
        patterns: [{ prefix: operand, parts: [], directoryOnly: windows ? /[\\/]$/u.test(operand) : operand.endsWith('/') }],
      });
      continue;
    }
    const pattern = operand.startsWith('~/') ? `${homedir().replaceAll('\\', '/')}/${operand.slice(2)}` : operand;
    const problem = syntaxProblem(pattern);
    if (problem !== undefined) return yield* new ToolFailed({ code: 'bad-pattern', reason: `${operand}: ${problem}` });
    const matcher = yield* Effect.try({
      try: () =>
        pathMatcher(pattern, {
          nonegate: true,
          nocomment: true,
          noext: true,
          dot: false,
          optimizationLevel: 0,
          platform: windows ? 'win32' : 'linux',
        }),
      catch: (cause) =>
        new ToolFailed({ code: 'bad-pattern', reason: `${operand}: ${cause instanceof Error ? cause.message : String(cause)}` }),
    });
    for (const expanded of matcher.globSet) {
      const problem = syntaxProblem(expanded);
      if (problem !== undefined) return yield* new ToolFailed({ code: 'bad-pattern', reason: `${operand}: ${problem}` });
    }
    const patterns: PathPattern[] = [];
    for (const row of matcher.set) {
      const parts = [...row];
      const directoryOnly = parts.at(-1) === '';
      while (parts.length > 1 && parts.at(-1) === '') parts.pop();
      const last = parts.at(-1);
      if (last === '.' || last === '..')
        return yield* new ToolFailed({ code: 'invalid-operand', reason: `rm does not accept a final . or .. operand: ${operand}.` });
      let split = parts.findIndex((part) => typeof part !== 'string');
      if (split < 0) split = parts.length;
      const prefix = parts.slice(0, split).join('/') || (parts[0] === '' ? '/' : '.');
      patterns.push({ prefix, parts: parts.slice(split), directoryOnly });
    }
    plans.push({ operand, patterns, magic: matcher.set.length > 1 || hasWildcard(pattern) });
  }
  return plans;
});
