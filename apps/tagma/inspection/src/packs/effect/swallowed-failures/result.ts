import type { Form } from './declaration';
import { bindingOf, resultOrigin, type OptionScope } from './absence';
import { childOf, childrenOf, FUNCTIONS, isNode, nameOf, type Node, type Reader, unwrapped } from './syntax';

type Test = { readonly input: Node; readonly failure: boolean };
type Flow = 'next' | 'loggedNext' | 'silent' | 'kept' | 'unknown';
export type Continuation = { readonly statements: readonly Node[]; readonly start: number };

const testOf = (raw: Node | undefined, reader: Reader, scope: OptionScope): Test | undefined => {
  const node = unwrapped(raw);
  if (node === undefined) return undefined;
  if (node.type === 'UnaryExpression' && node.operator === '!') {
    const test = testOf(childOf(node, 'argument'), reader, scope);
    return test === undefined ? undefined : { input: test.input, failure: !test.failure };
  }
  if (node.type === 'LogicalExpression') {
    const left = testOf(childOf(node, 'left'), reader, scope);
    if (left !== undefined && ((node.operator === '||' && left.failure) || (node.operator === '&&' && !left.failure))) return left;
    return undefined;
  }
  if (node.type === 'BinaryExpression' && ['===', '==', '!==', '!='].includes(String(node.operator))) {
    for (const side of ['left', 'right']) {
      const member = unwrapped(childOf(node, side));
      const value = unwrapped(childOf(node, side === 'left' ? 'right' : 'left'));
      if (member?.type !== 'MemberExpression' || nameOf(childOf(member, 'property')) !== '_tag') continue;
      const input = unwrapped(childOf(member, 'object'));
      if (input === undefined || !resultOrigin(input, reader, scope)) continue;
      if (value?.type !== 'Literal' || !['Success', 'Failure'].includes(String(value.value))) continue;
      const failure = value.value === 'Failure';
      return { input, failure: node.operator === '===' || node.operator === '==' ? failure : !failure };
    }
  }
  if (node.type === 'CallExpression') {
    const method = reader.member(childOf(node, 'callee'), 'Result');
    const args = childrenOf(node, 'arguments');
    const input = unwrapped(args[0]);
    if (args.length === 1 && input !== undefined && resultOrigin(input, reader, scope) && ['isFailure', 'isSuccess'].includes(method ?? ''))
      return { input, failure: method === 'isFailure' };
  }
  return undefined;
};

const sameInput = (raw: Node | undefined, input: Node, scope: OptionScope): boolean => {
  const node = unwrapped(raw);
  return node?.type === 'Identifier' && input.type === 'Identifier' && bindingOf(node, scope) === bindingOf(input, scope);
};

const eachChild = (node: Node, visit: (node: Node) => void): void => {
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) visit(child);
    } else if (isNode(value)) visit(value);
  }
};

const evidence = (raw: Node | undefined, input: Node, scope: OptionScope, memo: WeakMap<Node, boolean>): boolean => {
  const node = unwrapped(raw);
  if (node === undefined || FUNCTIONS.has(node.type)) return false;
  const held = memo.get(node);
  if (held !== undefined) return held;
  if (
    node.type === 'MemberExpression' &&
    nameOf(childOf(node, 'property')) === 'failure' &&
    sameInput(childOf(node, 'object'), input, scope)
  )
    return true;
  let found = false;
  if (node.type === 'Property') found = evidence(childOf(node, 'value'), input, scope, memo);
  else
    eachChild(node, (child) => {
      if (!found) found = evidence(child, input, scope, memo);
    });
  memo.set(node, found);
  return found;
};

const DISCRIMINANTS: ReadonlySet<string> = new Set(['_tag', 'kind', 'status', 'type']);

const typedValue = (node: Node): boolean => {
  if (node.type === 'NewExpression')
    return !['Set', 'Map', 'Array', 'Date', 'Object', 'String', 'Number', 'Boolean', 'Uint8Array'].includes(
      nameOf(childOf(node, 'callee')) ?? '',
    );
  return (
    node.type === 'ObjectExpression' &&
    childrenOf(node, 'properties').some(
      (property) =>
        DISCRIMINANTS.has(nameOf(childOf(property, 'key')) ?? '') && typeof unwrapped(childOf(property, 'value'))?.value === 'string',
    )
  );
};

const FAILS = new Set(['fail', 'failSync', 'failCause', 'failCauseSync', 'die', 'interrupt', 'never']);
const LOGS = new Set(['log', 'logTrace', 'logDebug', 'logInfo', 'logWarning', 'logError', 'logFatal']);

const flowsOf = (
  root: Node | undefined,
  reader: Reader,
  scope: OptionScope,
  input: Node,
  failure?: Node,
  after?: Continuation,
): readonly Flow[] => {
  const memo = new WeakMap<Node, readonly Flow[]>();
  const aliases = new Set<string>(failure === undefined ? [] : [nameOf(failure) ?? '']);
  const evidenceMemo = new WeakMap<Node, boolean>();
  let reasons = new WeakMap<Node, boolean>();
  const reason = (raw: Node | undefined): boolean => {
    const node = unwrapped(raw);
    if (node === undefined || FUNCTIONS.has(node.type)) return false;
    const held = reasons.get(node);
    if (held !== undefined) return held;
    let found = node.type === 'Identifier' && aliases.has(nameOf(node) ?? '');
    if (!found) found = evidence(node, input, scope, evidenceMemo);
    if (!found && node.type === 'Property') found = reason(childOf(node, 'value'));
    else if (!found)
      eachChild(node, (child) => {
        if (!found) found = reason(child);
      });
    reasons.set(node, found);
    return found;
  };
  const failureValue = (node: Node): boolean =>
    (node.type === 'Identifier' && aliases.has(nameOf(node) ?? '')) ||
    (node.type === 'MemberExpression' &&
      nameOf(childOf(node, 'property')) === 'failure' &&
      sameInput(childOf(node, 'object'), input, scope));
  const carried = (raw: Node | undefined): boolean => {
    const node = unwrapped(raw);
    if (node === undefined) return false;
    if (FUNCTIONS.has(node.type)) {
      const body = childOf(node, 'body');
      return body !== undefined && body.type !== 'BlockStatement' && body.type !== 'FunctionBody' && carried(body);
    }
    if (failureValue(node)) return true;
    if (node.type === 'ConditionalExpression') return carried(childOf(node, 'consequent')) && carried(childOf(node, 'alternate'));
    if (node.type === 'MemberExpression') return carried(childOf(node, 'object'));
    if (node.type === 'CallExpression' || node.type === 'NewExpression') return childrenOf(node, 'arguments').some(carried);
    if (node.type === 'TemplateLiteral') return childrenOf(node, 'expressions').some(carried);
    if (node.type === 'ArrayExpression')
      return childrenOf(node, 'elements').some((one) => carried(one.type === 'SpreadElement' ? childOf(one, 'argument') : one));
    if (node.type === 'ObjectExpression')
      return childrenOf(node, 'properties').some((one) => carried(childOf(one, one.type === 'SpreadElement' ? 'argument' : 'value')));
    return false;
  };
  const specificSide = (raw: Node | undefined): 'consequent' | 'alternate' | undefined => {
    const node = unwrapped(raw);
    if (node?.type === 'UnaryExpression' && node.operator === '!') {
      const side = specificSide(childOf(node, 'argument'));
      return side === undefined ? undefined : side === 'consequent' ? 'alternate' : 'consequent';
    }
    if (node?.type === 'CallExpression') return childrenOf(node, 'arguments').some(carried) ? 'consequent' : undefined;
    if (node?.type !== 'BinaryExpression') return undefined;
    if (node.operator === 'instanceof') return carried(childOf(node, 'left')) ? 'consequent' : undefined;
    if (!['===', '==', '!==', '!='].includes(String(node.operator))) return undefined;
    for (const side of ['left', 'right']) {
      const subject = unwrapped(childOf(node, side));
      const value = unwrapped(childOf(node, side === 'left' ? 'right' : 'left'));
      if (carried(subject) && value?.type === 'Literal' && typeof value.value === 'string' && !['Success', 'Failure'].includes(value.value))
        return node.operator === '===' || node.operator === '==' ? 'consequent' : 'alternate';
    }
    return undefined;
  };
  const recorded = (node: Node): boolean =>
    (node.type === 'CallExpression' && childrenOf(node, 'arguments').some(carried)) ||
    (node.type === 'AssignmentExpression' && carried(childOf(node, 'right')));
  const logged = (raw: Node): boolean => {
    const node = unwrapped(raw)!;
    if (node.type !== 'CallExpression') return false;
    const callee = unwrapped(childOf(node, 'callee'));
    const method = reader.member(callee);
    const service = callee?.type === 'MemberExpression' ? nameOf(childOf(callee, 'property')) : undefined;
    return (
      (LOGS.has(method ?? '') || ['warn', 'warning', 'error', 'logWarning', 'logError'].includes(service ?? '')) &&
      childrenOf(node, 'arguments').some(reason)
    );
  };
  const value = (raw: Node | undefined): readonly Flow[] => {
    const node = unwrapped(raw);
    if (node === undefined) return ['silent'];
    if (sameInput(node, input, scope) || typedValue(node)) return ['kept'];
    if (node.type === 'ConditionalExpression') {
      const test = testOf(childOf(node, 'test'), reader, scope);
      if (test !== undefined && sameInput(test.input, input, scope)) return value(childOf(node, test.failure ? 'consequent' : 'alternate'));
      const side = specificSide(childOf(node, 'test'));
      if (side !== undefined) return value(childOf(node, side === 'consequent' ? 'alternate' : 'consequent'));
      return [...value(childOf(node, 'consequent')), ...value(childOf(node, 'alternate'))];
    }
    if (node.type === 'SequenceExpression') {
      const expressions = childrenOf(node, 'expressions');
      if (expressions.slice(0, -1).some(logged)) return ['kept'];
      return value(expressions.at(-1));
    }
    if (failureValue(node)) return ['kept'];
    if (node.type === 'YieldExpression' || node.type === 'AwaitExpression') {
      const argument = unwrapped(childOf(node, 'argument'));
      if (
        argument?.type === 'NewExpression' ||
        FAILS.has(reader.member(argument) ?? '') ||
        (argument?.type === 'CallExpression' && FAILS.has(reader.member(childOf(argument, 'callee')) ?? ''))
      )
        return ['kept'];
      if (argument !== undefined && (logged(argument) || carried(argument))) return ['kept'];
      return ['unknown'];
    }
    if (node.type === 'CallExpression' && FAILS.has(reader.member(childOf(node, 'callee')) ?? ''))
      return [scope.generator ? 'silent' : 'kept'];
    if (node.type === 'CallExpression' && !scope.generator && reader.member(childOf(node, 'callee')) === 'succeed') {
      const answer = unwrapped(childrenOf(node, 'arguments')[0]);
      const effect = answer?.type === 'CallExpression' ? reader.member(childOf(answer, 'callee')) : reader.member(answer);
      return effect === undefined ? value(answer) : ['silent'];
    }
    return [carried(node) ? 'kept' : 'silent'];
  };
  const flow = (raw: Node | undefined): readonly Flow[] => {
    const node = unwrapped(raw);
    if (node === undefined) return ['next'];
    const held = memo.get(node);
    if (held !== undefined) return held;
    const read = readFlow(node);
    memo.set(node, read);
    return read;
  };
  const sequence = (statements: readonly Node[], start = 0, initial: readonly Flow[] = ['next']): readonly Flow[] => {
    let exits = initial;
    for (let at = start; at < statements.length; at += 1) {
      const statement = statements[at]!;
      if (!exits.includes('next') && !exits.includes('loggedNext')) break;
      const next = flow(statement);
      exits = [
        ...new Set(
          exits.flatMap((one) =>
            one === 'next'
              ? next
              : one === 'loggedNext'
                ? next.map((after) => (after === 'next' ? ('loggedNext' as const) : after === 'loggedNext' ? after : ('kept' as const)))
                : [one],
          ),
        ),
      ];
    }
    return exits;
  };
  const readFlow = (node: Node): readonly Flow[] => {
    if (node.type === 'ReturnStatement') return value(childOf(node, 'argument'));
    if (node.type === 'ThrowStatement') return ['kept'];
    if (node.type === 'ContinueStatement' || node.type === 'BreakStatement') return ['silent'];
    if (node.type === 'IfStatement') {
      const test = testOf(childOf(node, 'test'), reader, scope);
      if (test !== undefined && sameInput(test.input, input, scope)) return flow(childOf(node, test.failure ? 'consequent' : 'alternate'));
      const side = specificSide(childOf(node, 'test'));
      if (side === 'consequent') return ['kept', ...flow(childOf(node, 'alternate'))];
      if (side === 'alternate') return [...flow(childOf(node, 'consequent')), 'kept'];
      return [...flow(childOf(node, 'consequent')), ...flow(childOf(node, 'alternate'))];
    }
    if (node.type === 'BlockStatement' || node.type === 'FunctionBody') {
      const before = new Set(aliases);
      const exits = sequence(childrenOf(node, 'body'));
      aliases.clear();
      for (const name of before) aliases.add(name);
      reasons = new WeakMap();
      return exits;
    }
    if (node.type === 'ExpressionStatement') {
      const expression = unwrapped(childOf(node, 'expression'));
      if (expression?.type === 'YieldExpression' || expression?.type === 'AwaitExpression') {
        const argument = unwrapped(childOf(expression, 'argument'));
        if (argument !== undefined && logged(argument)) return ['loggedNext'];
        if (argument?.type === 'CallExpression' && LOGS.has(reader.member(childOf(argument, 'callee')) ?? '')) return ['next'];
        if (
          argument?.type === 'NewExpression' ||
          (argument?.type === 'CallExpression' && FAILS.has(reader.member(childOf(argument, 'callee')) ?? ''))
        )
          return ['kept'];
        if (carried(argument)) return ['loggedNext'];
        return ['next'];
      }
      if (
        expression !== undefined &&
        reader.member(childOf(expression, 'callee')) === undefined &&
        (logged(expression) || recorded(expression))
      )
        return ['loggedNext'];
      return ['next'];
    }
    if (node.type === 'VariableDeclaration') {
      for (const declaration of childrenOf(node, 'declarations')) {
        const initializer = unwrapped(childOf(declaration, 'init'));
        const name = nameOf(childOf(declaration, 'id'));
        if (name !== undefined) {
          if (carried(initializer)) aliases.add(name);
          else aliases.delete(name);
        }
      }
      reasons = new WeakMap();
      return ['next'];
    }
    if (FUNCTIONS.has(node.type) || node.type === 'EmptyStatement') return ['next'];
    return ['unknown'];
  };
  const initial =
    root === undefined || root.type === 'BlockStatement' || root.type === 'FunctionBody' || root.type.endsWith('Statement')
      ? flow(root)
      : value(root);
  return after === undefined ? initial : sequence(after.statements, after.start, initial);
};

const handled = (input: Node, scope: OptionScope): boolean => {
  const binding = bindingOf(input, scope);
  if (typeof binding === 'string') return false;
  for (let at: OptionScope | undefined = scope; at !== undefined; at = at.parent) if (at.handled.has(binding)) return true;
  return false;
};

export type ResultSite = { readonly form: Form; readonly judged: boolean; readonly parts: readonly Node[] };

const present = (...nodes: readonly (Node | undefined)[]): readonly Node[] => nodes.filter((one): one is Node => one !== undefined);

export const resultSite = (
  node: Node,
  reader: Reader,
  scope: OptionScope,
  condition: boolean,
  enclosing?: Node,
  after?: Continuation,
): ResultSite | null | undefined => {
  if (node.type === 'SwitchStatement') {
    const discriminant = unwrapped(childOf(node, 'discriminant'));
    const input =
      discriminant?.type === 'MemberExpression' && nameOf(childOf(discriminant, 'property')) === '_tag'
        ? unwrapped(childOf(discriminant, 'object'))
        : undefined;
    if (input === undefined || !resultOrigin(input, reader, scope)) return undefined;
    if (handled(input, scope)) return null;
    const cases = childrenOf(node, 'cases');
    const exact = cases.findIndex((one) => childOf(one, 'test')?.value === 'Failure');
    const start = exact < 0 ? cases.findIndex((one) => childOf(one, 'test') === undefined) : exact;
    const statements = start < 0 ? [] : cases.slice(start).flatMap((one) => childrenOf(one, 'consequent'));
    const flows = flowsOf(undefined, reader, scope, input, undefined, { statements, start: 0 });
    if (!flows.includes('silent') && !flows.includes('next') && !flows.includes('unknown')) return null;
    return {
      form: 'failureReturn',
      judged: !flows.includes('unknown'),
      parts: present(discriminant, ...(start < 0 ? [] : [cases[start]])),
    };
  }
  if (
    node.type === 'IfStatement' ||
    node.type === 'ConditionalExpression' ||
    node.type === 'LogicalExpression' ||
    (!condition &&
      (node.type === 'BinaryExpression' ||
        node.type === 'UnaryExpression' ||
        (node.type === 'CallExpression' && ['isFailure', 'isSuccess'].includes(reader.member(childOf(node, 'callee'), 'Result') ?? ''))))
  ) {
    const test = testOf(node.type === 'IfStatement' || node.type === 'ConditionalExpression' ? childOf(node, 'test') : node, reader, scope);
    if (test === undefined) return undefined;
    if (handled(test.input, scope)) return null;
    if (node.type === 'IfStatement' || node.type === 'ConditionalExpression') {
      const branch = childOf(node, test.failure ? 'consequent' : 'alternate');
      const own = flowsOf(branch, reader, scope, test.input);
      const flows =
        node.type === 'IfStatement' && own.includes('next') ? flowsOf(branch, reader, scope, test.input, undefined, after) : own;
      if (!flows.includes('silent') && !flows.includes('next') && !flows.includes('unknown')) {
        if (node.type === 'IfStatement') {
          const binding = bindingOf(test.input, scope);
          if (typeof binding !== 'string') scope.handled.add(binding);
        }
        return null;
      }
      return {
        form: node.type === 'IfStatement' ? 'failureReturn' : 'failureConditional',
        judged: !flows.includes('unknown'),
        parts: present(childOf(node, 'test'), branch),
      };
    }
    if (!condition) return { form: 'failureConditional', judged: true, parts: [node] };
  }
  if (node.type !== 'CallExpression') return undefined;
  const method = reader.member(childOf(node, 'callee'), 'Result');
  if (method !== 'match' && method !== 'getOrElse') return undefined;
  const args = childrenOf(node, 'arguments');
  let input = args.length === 2 ? args[0] : undefined;
  if (input === undefined && enclosing !== undefined) {
    const callee = unwrapped(childOf(enclosing, 'callee'));
    if (callee?.type === 'MemberExpression' && nameOf(childOf(callee, 'property')) === 'pipe') input = childOf(callee, 'object');
    else if (callee !== undefined && reader.piped(callee)) input = childrenOf(enclosing, 'arguments')[0];
  }
  if (input === undefined || !resultOrigin(input, reader, scope)) return undefined;
  if (handled(input, scope)) return null;
  const cases = unwrapped(args.at(-1));
  const properties = cases?.type === 'ObjectExpression' ? childrenOf(cases, 'properties') : [];
  const callee = childOf(node, 'callee');
  if (properties.some((one) => one.type === 'SpreadElement' || one.computed === true))
    return { form: method, judged: false, parts: [node] };
  const handler =
    method === 'getOrElse'
      ? cases
      : cases?.type === 'ObjectExpression'
        ? unwrapped(childOf(properties.filter((one) => nameOf(childOf(one, 'key')) === 'onFailure').at(-1) ?? node, 'value'))
        : undefined;
  if (handler === undefined || !FUNCTIONS.has(handler.type)) return { form: method, judged: false, parts: [node] };
  const flows = flowsOf(childOf(handler, 'body'), reader, scope, input, childrenOf(handler, 'params')[0]);
  if (!flows.includes('silent') && !flows.includes('next') && !flows.includes('unknown')) return null;
  return { form: method, judged: !flows.includes('unknown'), parts: present(callee, handler) };
};
