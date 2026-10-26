import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import { applyColorReplacements, type LanguageRegistration, normalizeTheme } from 'shiki/core';
import { type IGrammar, type IOnigLib, INITIAL, Registry, type StateStack, EncodedTokenMetadata } from 'shiki/textmate';
import {
  type CodeToken,
  HIGHLIGHT_LINE_CHAR_CAP,
  HIGHLIGHT_LINE_TIME_LIMIT,
  languageLoaders,
  normalizeCodeLanguage,
  type ShikiCodeLanguage,
} from './colours';
import { theme } from './theme';

export type LineTokens = { tokens: CodeToken[] | null; end: StateStack };

export type LineTokenizer = {
  readonly initial: StateStack;
  line(body: string, from: StateStack): LineTokens;
  advance(body: string, from: StateStack): StateStack;
};

let onigLib: Promise<IOnigLib> | undefined;

function onig(): Promise<IOnigLib> {
  onigLib ??= createOnigurumaEngine(import('shiki/wasm')).then(
    (engine) => ({
      createOnigScanner: (patterns) => engine.createScanner(patterns),
      createOnigString: (text) => engine.createString(text),
    }),
    (error: unknown) => {
      onigLib = undefined;
      throw error;
    },
  );
  return onigLib;
}

const standing = new Map<string, Promise<LineTokenizer>>();
const resolved = normalizeTheme(theme);

export function lineTokenizerFor(language: string | undefined): Promise<LineTokenizer | undefined> {
  const named = normalizeCodeLanguage(language);
  if (named === 'text' || named === 'ansi') return Promise.resolve(undefined);
  let built = standing.get(named);
  if (built === undefined) {
    built = build(named);
    standing.set(named, built);
    built.catch(() => standing.delete(named));
  }
  return built;
}

async function registrationsOf(named: ShikiCodeLanguage): Promise<LanguageRegistration[]> {
  const loaded = new Set<string>([named]);
  const found = new Map<string, LanguageRegistration>();
  const queue: ShikiCodeLanguage[] = [named];
  for (let at = 0; at < queue.length; at += 1) {
    const registrations = (await languageLoaders[queue[at] as ShikiCodeLanguage]()).default;
    for (const registration of registrations) {
      found.set(registration.scopeName, registration);
      for (const lazy of registration.embeddedLangsLazy ?? []) {
        if (lazy in languageLoaders && !loaded.has(lazy)) {
          loaded.add(lazy);
          queue.push(lazy as ShikiCodeLanguage);
        }
      }
    }
  }
  return [...found.values()];
}

async function build(named: ShikiCodeLanguage): Promise<LineTokenizer> {
  const [registrations, lib] = await Promise.all([registrationsOf(named), onig()]);
  const scopes = new Map<string, LanguageRegistration>();
  const injections = new Map<string, string[]>();
  for (const registration of registrations) {
    scopes.set(registration.scopeName, registration);
    for (const target of registration.injectTo ?? []) injections.set(target, [...(injections.get(target) ?? []), registration.scopeName]);
  }
  const registry = new Registry({
    onigLib: lib,
    theme: resolved,
    loadGrammar: (scope) => scopes.get(scope),
    getInjections: (scope) => {
      const parts = scope.split('.');
      const found: string[] = [];
      for (let upTo = 1; upTo <= parts.length; upTo += 1) found.push(...(injections.get(parts.slice(0, upTo).join('.')) ?? []));
      return found;
    },
  });
  const main = registrations.find((registration) => registration.name === named);
  const grammar =
    main &&
    registry.loadGrammarWithConfiguration(main.scopeName, 1, {
      balancedBracketSelectors: main.balancedBracketSelectors ?? ['*'],
      unbalancedBracketSelectors: main.unbalancedBracketSelectors ?? [],
    });
  if (!grammar) throw new Error(`The ${named} grammar did not load`);
  return tokenizer(
    grammar,
    registry.getColorMap().map((colour) => applyColorReplacements(colour, resolved.colorReplacements)),
  );
}

function tokenizer(grammar: IGrammar, colours: readonly string[]): LineTokenizer {
  const skipped = (body: string): boolean => body === '' || body.length >= HIGHLIGHT_LINE_CHAR_CAP;
  return {
    initial: INITIAL,
    advance: (body, from) => (skipped(body) ? from : grammar.tokenizeLine2(body, from, HIGHLIGHT_LINE_TIME_LIMIT).ruleStack),
    line(body, from) {
      if (skipped(body)) return { tokens: null, end: from };
      const result = grammar.tokenizeLine2(body, from, HIGHLIGHT_LINE_TIME_LIMIT);
      const tokens: CodeToken[] = [];
      const count = result.tokens.length / 2;
      for (let at = 0; at < count; at += 1) {
        const start = result.tokens[2 * at] as number;
        const stop = at + 1 < count ? (result.tokens[2 * at + 2] as number) : body.length;
        if (start === stop) continue;
        const metadata = result.tokens[2 * at + 1] as number;
        const color = colours[EncodedTokenMetadata.getForeground(metadata)];
        tokens.push({ text: body.slice(start, stop), color });
      }
      return { tokens: tokens.length === 0 ? null : tokens, end: result.ruleStack };
    },
  };
}
