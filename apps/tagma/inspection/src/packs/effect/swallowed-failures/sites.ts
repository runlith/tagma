import { UnsupportedSource } from '@runlith/code-facts/imports';
import { scriptsOf } from '@runlith/code-facts/adapters';
import { failureOf, parsedNow } from '@runlith/code-facts/js/imports';
import { ABSENCE_FORMS, FORMS, type Form, TOP } from './declaration';

import { childOf, childrenOf, FUNCTIONS, isNode, nameOf, type Node, type Reader, readerOf, unwrapped } from './syntax';
import { absenceForm, bindingOf, callbackInput, optionScope, type OptionScope, readBinding, testedBinding } from './absence';
import { type Continuation, resultSite } from './result';

type Outcome = 'succeeds' | 'fails' | 'unknown';

export type Site = {
  readonly line: number;
  readonly symbol: string;
  readonly form: Form;
  readonly judged: boolean;
  readonly site: string;
};

const IS_FORM: ReadonlySet<string> = new Set(FORMS.filter((form) => !(ABSENCE_FORMS as readonly string[]).includes(form)));

const ALWAYS: ReadonlySet<string> = new Set(['orElseSucceed', 'ignore', 'ignoreCause']);

const SUCCEEDS_CALLED = new Set([
  'succeed',
  'succeedSome',
  'sync',
  'asVoid',
  'as',
  'ignore',
  'ignoreCause',
  'orElseSucceed',
  'log',
  'logTrace',
  'logDebug',
  'logInfo',
  'logWarning',
  'logError',
  'logFatal',
]);

const SUCCEEDS_VALUE = new Set(['void', 'succeedNone', 'asVoid', 'ignore', 'ignoreCause']);

const FAILS_CALLED = new Set(['fail', 'failSync', 'failCause', 'failCauseSync', 'die']);

const FAILS_VALUE = new Set(['interrupt', 'never', 'fail', 'failCause', 'die']);

const LAST_SUCCEEDS = new Set(['as', 'asVoid', 'ignore', 'ignoreCause', 'orElseSucceed']);

const LAST_TARGET = new Set(['andThen', 'flatMap']);

const THROUGH = new Set([
  'map',
  'tap',
  'tapError',
  'tapCause',
  'tapDefect',
  'mapError',
  'withSpan',
  'annotateLogs',
  'annotateSpans',
  'withLogSpan',
  'uninterruptible',
  'interruptible',
  'withParentSpan',
]);

const combined = (outcomes: readonly Outcome[]): Outcome =>
  outcomes.length === 0 ? 'unknown' : outcomes.includes('fails') ? 'fails' : outcomes.includes('unknown') ? 'unknown' : 'succeeds';

const bodyOutcomes = (
  body: Node,
  reader: Reader,
  generator: boolean,
): { readonly returns: readonly Outcome[]; readonly fails: boolean } => {
  const returns: Outcome[] = [];
  let fails = false;
  const visit = (node: Node): void => {
    if (FUNCTIONS.has(node.type) || node.type === 'ClassDeclaration' || node.type === 'ClassExpression') return;
    if (node.type === 'ThrowStatement') fails = true;
    if (node.type === 'ReturnStatement') {
      const argument = unwrapped(childOf(node, 'argument'));
      if (!generator) returns.push(argument === undefined ? 'unknown' : effectOutcome(argument, reader));
      else if (argument === undefined) returns.push('succeeds');
      else if (argument.type === 'YieldExpression' && argument.delegate === true) returns.push(yieldedOutcome(argument, reader));
      else returns.push('succeeds');
    }
    if (generator && node.type === 'YieldExpression' && node.delegate === true && yieldedOutcome(node, reader) === 'fails') fails = true;
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const one of value) if (isNode(one)) visit(one);
      } else if (isNode(value)) visit(value);
    }
  };
  visit(body);
  return { returns, fails };
};

const yieldedOutcome = (node: Node, reader: Reader): Outcome => {
  const argument = unwrapped(childOf(node, 'argument'));
  if (argument === undefined) return 'unknown';
  if (argument.type === 'NewExpression') return 'fails';
  return effectOutcome(argument, reader);
};

const generatorOutcome = (fn: Node, reader: Reader): Outcome => {
  const body = childOf(fn, 'body');
  if (body === undefined) return 'unknown';
  const read = bodyOutcomes(body, reader, true);
  if (read.fails) return 'fails';
  if (read.returns.length === 0) return 'succeeds';
  return combined(read.returns);
};

const pipeOutcome = (head: Node | undefined, steps: readonly Node[], reader: Reader): Outcome => {
  for (let at = steps.length - 1; at >= 0; at -= 1) {
    const step = unwrapped(steps[at]) as Node;
    const valued = reader.member(step);
    if (valued !== undefined) {
      if (valued === 'asVoid' || valued === 'ignore' || valued === 'ignoreCause') return 'succeeds';
      if (THROUGH.has(valued)) continue;
      return 'unknown';
    }
    if (step.type !== 'CallExpression') return 'unknown';
    const method = reader.member(childOf(step, 'callee'));
    if (method === undefined) return 'unknown';
    if (LAST_SUCCEEDS.has(method)) return 'succeeds';
    if (LAST_TARGET.has(method)) {
      const target = childrenOf(step, 'arguments')[0];
      return target === undefined ? 'unknown' : targetOutcome(target, reader);
    }
    if (!THROUGH.has(method)) return 'unknown';
  }
  return head === undefined ? 'unknown' : effectOutcome(head, reader);
};

const targetOutcome = (raw: Node, reader: Reader): Outcome => {
  const target = unwrapped(raw) as Node;
  if (FUNCTIONS.has(target.type)) return handlerOutcome(target, reader);
  const method = reader.member(target);
  if (method !== undefined && FAILS_CALLED.has(method)) return 'fails';
  if (method !== undefined && SUCCEEDS_CALLED.has(method)) return 'succeeds';
  return effectOutcome(target, reader);
};

const effectOutcome = (raw: Node, reader: Reader): Outcome => {
  const node = unwrapped(raw) as Node;
  if (node.type === 'NewExpression') return 'fails';
  if (node.type === 'ConditionalExpression') {
    return combined([
      effectOutcome(childOf(node, 'consequent') as Node, reader),
      effectOutcome(childOf(node, 'alternate') as Node, reader),
    ]);
  }
  if (node.type === 'SequenceExpression') {
    const last = childrenOf(node, 'expressions').at(-1);
    return last === undefined ? 'unknown' : effectOutcome(last, reader);
  }
  const valued = reader.member(node);
  if (valued !== undefined) return SUCCEEDS_VALUE.has(valued) ? 'succeeds' : FAILS_VALUE.has(valued) ? 'fails' : 'unknown';
  if (node.type !== 'CallExpression') return 'unknown';
  const callee = unwrapped(childOf(node, 'callee'));
  const args = childrenOf(node, 'arguments');
  if (callee?.type === 'MemberExpression' && callee.computed !== true && nameOf(childOf(callee, 'property')) === 'pipe') {
    return pipeOutcome(childOf(callee, 'object'), args, reader);
  }
  if (callee !== undefined && reader.piped(callee)) return pipeOutcome(args[0], args.slice(1), reader);
  const method = reader.member(callee);
  if (method === undefined) return 'unknown';
  if (SUCCEEDS_CALLED.has(method)) return 'succeeds';
  if (FAILS_CALLED.has(method)) return 'fails';
  if (LAST_TARGET.has(method) && args.length === 2) return targetOutcome(args[1] as Node, reader);
  if (method === 'gen') {
    const fn = unwrapped(args.at(-1));
    return fn !== undefined && fn.generator === true ? generatorOutcome(fn, reader) : 'unknown';
  }
  if (method === 'suspend') {
    const fn = unwrapped(args[0]);
    return fn === undefined || !FUNCTIONS.has(fn.type) ? 'unknown' : handlerOutcome(fn, reader);
  }
  return 'unknown';
};

const handlerOutcome = (raw: Node, reader: Reader): Outcome => {
  const node = unwrapped(raw) as Node;
  if (FUNCTIONS.has(node.type)) {
    if (node.generator === true || node.async === true) return 'unknown';
    const body = childOf(node, 'body');
    if (body === undefined) return 'unknown';
    if (body.type !== 'BlockStatement' && body.type !== 'FunctionBody') return effectOutcome(body, reader);
    const read = bodyOutcomes(body, reader, false);
    if (read.fails) return 'fails';
    return combined(read.returns);
  }
  const method = reader.member(node);
  if (method === undefined) return 'unknown';
  if (SUCCEEDS_CALLED.has(method)) return 'succeeds';
  if (FAILS_CALLED.has(method)) return 'fails';
  return 'unknown';
};

const topNameOf = (statement: Node): readonly { readonly node: Node; readonly name: string }[] => {
  const inner =
    statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
      ? childOf(statement, 'declaration')
      : statement;
  if (inner === undefined) return [{ node: statement, name: TOP }];
  if (inner.type === 'VariableDeclaration') {
    return childrenOf(inner, 'declarations').map((declarator) => ({ node: declarator, name: nameOf(childOf(declarator, 'id')) ?? TOP }));
  }
  const named = nameOf(childOf(inner, 'id'));
  if (named !== undefined) return [{ node: inner, name: named }];
  return [{ node: inner, name: statement.type === 'ExportDefaultDeclaration' ? 'default' : TOP }];
};

const NAMING = new Set([
  'FunctionDeclaration',
  'ClassDeclaration',
  'VariableDeclarator',
  'MethodDefinition',
  'PropertyDefinition',
  'Property',
  'TSAbstractMethodDefinition',
]);

const innerNameOf = (node: Node): string | undefined => {
  if (!NAMING.has(node.type)) return undefined;
  if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration' || node.type === 'VariableDeclarator')
    return nameOf(childOf(node, 'id'));
  if (node.computed === true) return undefined;
  return nameOf(childOf(node, 'key'));
};

const eachChild = (node: Node, visit: (child: Node) => void): void => {
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) visit(child);
    } else if (isNode(value)) visit(value);
  }
};

const recoveryOf = (node: Node, reader: Reader): Node | undefined => {
  if (node.type !== 'CallExpression') return undefined;
  const callee = childOf(node, 'callee');
  const args = childrenOf(node, 'arguments');
  const form = reader.member(callee);
  if (form !== undefined && FALLBACK_FORMS.has(form)) {
    const fallback = fallbackOf(form, args);
    return fallback === 'none' ? undefined : fallback === 'unknown' ? unwrapped(args.at(-1)) : fallback;
  }
  if (['catch', 'catchEager', 'catchCause', 'orElseSucceed'].includes(form ?? '')) return unwrapped(args.at(-1));
  for (const module of ['Effect', 'Result', 'Exit', 'Either', 'Option']) {
    const method = reader.member(callee, module);
    if (method === 'getOrElse') return unwrapped(args.at(-1));
    if (method !== 'match') continue;
    const cases = unwrapped(args.at(-1));
    if (cases?.type !== 'ObjectExpression') return undefined;
    const key = module === 'Option' ? 'onNone' : module === 'Either' ? 'onLeft' : 'onFailure';
    const property = childrenOf(cases, 'properties')
      .filter((one) => nameOf(childOf(one, 'key')) === key)
      .at(-1);
    return property === undefined ? undefined : unwrapped(childOf(property, 'value'));
  }
  return undefined;
};

const recoveryFunctions = (root: Node, reader: Reader): ReadonlySet<Node> => {
  const kept = new Set<Node>();
  const returned = (node: Node): void => {
    if (FUNCTIONS.has(node.type)) return;
    if (node.type === 'ReturnStatement' || node.type === 'YieldExpression' || node.type === 'AwaitExpression')
      preserve(childOf(node, 'argument'));
    else eachChild(node, returned);
  };
  const preserve = (raw: Node | undefined): void => {
    const node = unwrapped(raw);
    if (node === undefined) return;
    if (node.type === 'YieldExpression' || node.type === 'AwaitExpression') {
      preserve(childOf(node, 'argument'));
      return;
    }
    if (FUNCTIONS.has(node.type)) {
      kept.add(node);
      const body = childOf(node, 'body');
      if (body?.type === 'BlockStatement' || body?.type === 'FunctionBody') returned(body);
      else preserve(body);
      return;
    }
    if (node.type === 'SequenceExpression') {
      preserve(childrenOf(node, 'expressions').at(-1));
      return;
    }
    if (node.type === 'ConditionalExpression') {
      preserve(childOf(node, 'consequent'));
      preserve(childOf(node, 'alternate'));
      return;
    }
    if (node.type !== 'CallExpression') return;
    const callee = unwrapped(childOf(node, 'callee'));
    const args = childrenOf(node, 'arguments');
    if (callee?.type === 'MemberExpression' && nameOf(childOf(callee, 'property')) === 'pipe') {
      preserve(childOf(callee, 'object'));
      for (const step of args) preserve(step);
      return;
    }
    if (callee !== undefined && reader.piped(callee)) {
      for (const step of args) preserve(step);
      return;
    }
    const method = reader.member(callee) ?? (callee?.type === 'CallExpression' ? reader.member(childOf(callee, 'callee')) : undefined);
    if (
      LAST_TARGET.has(method ?? '') ||
      ['gen', 'fn', 'fnUntraced', 'sync', 'suspend', 'promise', 'try', 'tryPromise', 'callback'].includes(method ?? '')
    ) {
      for (const argument of args) {
        if (['try', 'tryPromise'].includes(method ?? '') && argument.type === 'ObjectExpression') {
          for (const property of childrenOf(argument, 'properties')) preserve(childOf(property, 'value'));
        } else preserve(argument);
      }
    }
  };
  if (FUNCTIONS.has(root.type)) preserve(root);
  else preserve(recoveryOf(root, reader));
  return kept;
};

const shapeOf = (text: string, at: number, site: Node, reader: Reader): string => {
  const kept = recoveryFunctions(site, reader);
  const bodies: Node[] = [];
  const collect = (node: Node): void => {
    const body = node !== site && FUNCTIONS.has(node.type) && !kept.has(node) ? childOf(node, 'body') : undefined;
    if (body !== undefined) bodies.push(body);
    eachChild(node, (child) => {
      if (child !== body) collect(child);
    });
  };
  collect(site);
  let shape = '';
  let from = site.start;
  for (const body of bodies.sort((left, right) => left.start - right.start)) {
    if (body.start < from || body.end > site.end) continue;
    shape += `${text.slice(at + from, at + body.start)}{}`;
    from = body.end;
  }
  return (shape + text.slice(at + from, at + site.end)).replace(/\s+/g, ' ').trim();
};

const startsOf = (text: string): readonly number[] => {
  const starts = [0];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
  return starts;
};

const lineAt = (starts: readonly number[], offset: number): number => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] as number) <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
};

export const sitesIn = (path: string, text: string): readonly Site[] => {
  const scripts = scriptsOf(text, path);
  const parsed = scripts.map((script) => {
    const one = parsedNow(path, script);
    const failure = failureOf(one);
    if (failure !== undefined) throw new UnsupportedSource(path, failure.message);
    return { at: script.at, program: one.program as unknown as Node };
  });
  const reader = readerOf(parsed.map((one) => one.program));
  const starts = startsOf(text);
  const sites: (Site & { readonly offset: number })[] = [];
  const unjudged = new Set<Site>();
  for (const { at, program } of parsed) {
    const references = new Map<Node, Map<Node | string, { first: number; last: number }>>();
    const candidates: { site: Site; node: Node; fn: Node; binding: Node | string }[] = [];
    const callees = new Set<Node>();
    const inputs = new Map<Node, Node>();
    const following = new Map<Node, Continuation>();
    const siteOf = (...nodes: readonly Node[]): string => {
      const spelled = nodes.map((node) => shapeOf(text, at, node, reader)).join(' | ');
      return Bun.hash(spelled).toString(16).padStart(8, '0').slice(-8);
    };
    const visit = (
      node: Node,
      top: string,
      inner: string | undefined,
      call: Node | undefined,
      outer: OptionScope,
      fn: Node,
      parent?: Node,
      key = '',
      condition = false,
      logging = false,
    ): void => {
      if (node.type === 'ImportDeclaration') return;
      const scope = optionScope(node, outer, reader, inputs.get(node));
      if (FUNCTIONS.has(node.type)) {
        condition = false;
        logging = false;
      }
      if (node.type === 'CallExpression') {
        const callee = unwrapped(childOf(node, 'callee'));
        const member = callee?.type === 'MemberExpression' ? nameOf(childOf(callee, 'property')) : undefined;
        logging ||=
          (reader.member(callee) ?? '').startsWith('log') || ['warn', 'warning', 'error', 'logWarning', 'logError'].includes(member ?? '');
      }
      if (node.type === 'BlockStatement' || node.type === 'FunctionBody') {
        const statements = childrenOf(node, 'body');
        for (let start = 0; start < statements.length; start += 1) following.set(statements[start]!, { statements, start: start + 1 });
      }
      if (node.type === 'CallExpression') {
        const input = callbackInput(node, call, reader);
        const callback = unwrapped(childrenOf(node, 'arguments').at(-1));
        if (input !== undefined && callback !== undefined && FUNCTIONS.has(callback.type)) inputs.set(callback, input);
      }
      const functionOf = FUNCTIONS.has(node.type) ? node : fn;
      const binding = logging ? undefined : readBinding(node, parent, key, reader);
      if (binding !== undefined) {
        const named = bindingOf(binding, scope);
        let reads = references.get(functionOf);
        if (reads === undefined) {
          reads = new Map();
          references.set(functionOf, reads);
        }
        const held = reads.get(named);
        if (held === undefined) reads.set(named, { first: node.start, last: node.end });
        else {
          held.first = Math.min(held.first, node.start);
          held.last = Math.max(held.last, node.end);
        }
      }
      const named = innerNameOf(node);
      const within = named !== undefined && named !== top ? named : inner;
      const symbol = top === TOP || within === undefined ? top : `${top}.${within}`;
      const result = resultSite(node, reader, scope, condition, call, following.get(node));
      const absence = result === undefined ? absenceForm(node, reader, scope, call) : result?.form;
      if (absence !== undefined) {
        const offset = at + node.start;
        const site = {
          offset,
          line: lineAt(starts, offset),
          symbol,
          form: absence,
          judged: result?.judged ?? true,
          site: siteOf(...(result?.parts ?? [node])),
        };
        sites.push(site);
        const tested = testedBinding(node);
        if (tested !== undefined) candidates.push({ site, node, fn: functionOf, binding: bindingOf(tested, scope) });
      }
      if (node.type === 'CallExpression') {
        const callee = unwrapped(childOf(node, 'callee'));
        const form = reader.member(callee);
        if (callee !== undefined && form !== undefined && IS_FORM.has(form)) {
          callees.add(callee);
          const outcome = ALWAYS.has(form) ? 'succeeds' : handlerOf(node, form, reader);
          if (outcome !== 'fails' && outcome !== 'none') {
            const offset = at + callee.start;
            sites.push({
              offset,
              line: lineAt(starts, offset),
              symbol,
              form: form as Form,
              judged: outcome === 'succeeds',
              site: siteOf(node),
            });
          }
        }
      } else if (node.type === 'MemberExpression' && !callees.has(node)) {
        const form = reader.member(node);
        if (form !== undefined && IS_FORM.has(form) && !FALLBACK_FORMS.has(form)) {
          const offset = at + node.start;
          sites.push({
            offset,
            line: lineAt(starts, offset),
            symbol,
            form: form as Form,
            judged: ALWAYS.has(form),
            site: siteOf(call ?? node),
          });
        }
      }
      const enclosing = node.type === 'CallExpression' ? node : call;
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (Array.isArray(value)) {
          for (const one of value) if (isNode(one)) visit(one, top, within, enclosing, scope, functionOf, node, key, condition, logging);
        } else if (isNode(value)) {
          const testing = key === 'test' || (node.type === 'LogicalExpression' && key === 'left');
          const branch = node.type === 'IfStatement' && (key === 'consequent' || key === 'alternate');
          const childScope = branch ? { parent: scope, names: new Map(), handled: new Set<Node>(), generator: scope.generator } : scope;
          visit(value, top, within, enclosing, childScope, functionOf, node, key, condition || testing, logging);
        }
      }
    };
    const scope: OptionScope = { names: new Map(), handled: new Set(), generator: false };
    for (const statement of childrenOf(program, 'body')) {
      optionScope(childOf(statement, 'declaration') ?? statement, scope, reader);
      for (const { node, name } of topNameOf(statement)) visit(node, name, undefined, undefined, scope, program);
    }
    for (const { site, node, fn, binding } of candidates) {
      const reads = references.get(fn)?.get(binding);
      if (reads !== undefined && (reads.first < node.start || reads.last > node.end)) unjudged.add(site);
    }
  }
  return sites
    .sort((left, right) => left.offset - right.offset)
    .map((one) => ({ line: one.line, symbol: one.symbol, form: one.form, judged: one.judged && !unjudged.has(one), site: one.site }));
};

const isTag = (node: Node | undefined): boolean => {
  const at = unwrapped(node);
  return (
    at !== undefined &&
    (at.type === 'Literal' || at.type === 'StringLiteral' || at.type === 'TemplateLiteral' || at.type === 'ArrayExpression')
  );
};

const isCases = (node: Node | undefined): boolean => unwrapped(node)?.type === 'ObjectExpression';

const isFunction = (node: Node | undefined): boolean => {
  const at = unwrapped(node);
  return at !== undefined && FUNCTIONS.has(at.type);
};

const FALLBACKS: Readonly<Record<string, { readonly arity: number; readonly piped: (args: readonly Node[]) => boolean | undefined }>> = {
  catchTag: { arity: 2, piped: (args) => (isTag(args[0]) ? true : isTag(args[1]) ? false : undefined) },
  catchTags: { arity: 1, piped: (args) => (isCases(args[0]) ? true : isCases(args[1]) ? false : undefined) },
  catchReason: {
    arity: 3,
    piped: (args) => (isTag(args[0]) && isTag(args[1]) ? true : isTag(args[1]) && isTag(args[2]) ? false : undefined),
  },
  catchReasons: { arity: 2, piped: (args) => (isCases(args[1]) ? true : isCases(args[2]) ? false : undefined) },
  catchIf: { arity: 2, piped: (args) => (isFunction(args[0]) ? true : undefined) },
  catchFilter: { arity: 2, piped: (args) => (isFunction(args[0]) ? true : undefined) },
};

export const FALLBACK_FORMS: ReadonlySet<string> = new Set(Object.keys(FALLBACKS));

const fallbackOf = (form: string, args: readonly Node[]): Node | 'none' | 'unknown' => {
  const shape = FALLBACKS[form] as (typeof FALLBACKS)[string];
  if (args.length <= shape.arity) return 'none';
  if (args.length === shape.arity + 2) return args[shape.arity + 1] as Node;
  if (args.length > shape.arity + 2) return 'unknown';
  const piped = shape.piped(args);
  return piped === undefined ? 'unknown' : piped ? (args[shape.arity] as Node) : 'none';
};

const handlerOf = (call: Node, form: string, reader: Reader): Outcome | 'none' => {
  const args = childrenOf(call, 'arguments');
  if (args.some((one) => one.type === 'SpreadElement')) return 'unknown';
  if (FALLBACK_FORMS.has(form)) {
    const fallback = fallbackOf(form, args);
    if (fallback === 'unknown' && args.length === FALLBACKS[form]!.arity + 1 && handlerOutcome(args.at(-1)!, reader) === 'fails')
      return 'fails';
    return fallback === 'none' || fallback === 'unknown' ? fallback : handlerOutcome(fallback, reader);
  }
  const handler = args.at(-1);
  if (handler === undefined || args.length > 2) return 'unknown';
  return handlerOutcome(handler, reader);
};
