import type { Form } from './declaration';
import { childOf, childrenOf, FUNCTIONS, nameOf, type Node, type Reader, unwrapped } from './syntax';

type Flow = 'absent' | 'other' | 'next';

const values = new WeakMap<Node, boolean>();

const absent = (raw: Node | undefined): boolean => {
  const node = unwrapped(raw);
  if (node === undefined) return true;
  const held = values.get(node);
  if (held !== undefined) return held;
  const read = readAbsence(node);
  values.set(node, read);
  return read;
};

const readAbsence = (node: Node): boolean => {
  if (node.type === 'Literal') return node.value === null || node.value === false || node.value === 0 || node.value === '';
  if (node.type === 'Identifier') return node.name === 'undefined';
  if (node.type === 'ArrayExpression') return Array.isArray(node.elements) && node.elements.length === 0;
  if (node.type === 'ObjectExpression') return childrenOf(node, 'properties').length === 0;
  if (node.type === 'NewExpression') {
    const callee = unwrapped(childOf(node, 'callee'));
    return callee?.type === 'Identifier' && (callee.name === 'Set' || callee.name === 'Map') && childrenOf(node, 'arguments').length === 0;
  }
  if (node.type === 'ConditionalExpression') return absent(childOf(node, 'consequent')) && absent(childOf(node, 'alternate'));
  return false;
};

const flows = new WeakMap<Node, readonly Flow[]>();

const flowOf = (node: Node | undefined): readonly Flow[] => {
  if (node === undefined) return ['next'];
  const held = flows.get(node);
  if (held !== undefined) return held;
  const read = readFlow(node);
  flows.set(node, read);
  return read;
};

const readFlow = (node: Node): readonly Flow[] => {
  if (node.type === 'ReturnStatement') return [absent(childOf(node, 'argument')) ? 'absent' : 'other'];
  if (node.type === 'IfStatement') return [...flowOf(childOf(node, 'consequent')), ...flowOf(childOf(node, 'alternate'))];
  if (node.type === 'BlockStatement' || node.type === 'FunctionBody') {
    let exits: readonly Flow[] = ['next'];
    for (const statement of childrenOf(node, 'body')) {
      if (!exits.includes('next')) break;
      exits = [...new Set([...exits.filter((one) => one !== 'next'), ...flowOf(statement)])];
    }
    return exits;
  }
  if (node.type === 'VariableDeclaration')
    return childrenOf(node, 'declarations').every((one) => FUNCTIONS.has(unwrapped(childOf(one, 'init'))?.type ?? ''))
      ? ['next']
      : ['other'];
  return ['EmptyStatement', 'FunctionDeclaration'].includes(node.type) ? ['next'] : ['other'];
};

const returnsAbsence = (node: Node | undefined): boolean => flowOf(node).every((one) => one === 'absent');

const handlerAbsence = (raw: Node | undefined): boolean => {
  const fn = unwrapped(raw);
  if (fn === undefined || !FUNCTIONS.has(fn.type) || fn.async === true || fn.generator === true) return false;
  const body = childOf(fn, 'body');
  if (body === undefined) return false;
  if (body.type !== 'BlockStatement' && body.type !== 'FunctionBody') return absent(body);
  return flowOf(body).every((one) => one !== 'other');
};

type Parsing = 'decoder' | 'result';
type Binding = { readonly origin: boolean; readonly result: boolean; readonly parsing: Parsing | undefined; readonly node: Node };

export type OptionScope = {
  readonly parent?: OptionScope;
  readonly names: Map<string, Binding>;
  readonly handled: Set<Node>;
  readonly generator: boolean;
};

const namedBinding = (name: string, scope: OptionScope) => {
  for (let at: OptionScope | undefined = scope; at !== undefined; at = at.parent) {
    const value = at.names.get(name);
    if (value !== undefined) return value;
  }
  return undefined;
};

export const bindingOf = (node: Node, scope: OptionScope): Node | string =>
  namedBinding(nameOf(node) ?? '', scope)?.node ?? String(node.name);

const producesOption = (node: Node | undefined, reader: Reader): boolean =>
  reader.member(node) === 'option' || reader.member(node, 'Result') === 'getSuccess' || reader.member(node, 'Either') === 'getRight';

const pipeline = (node: Node, reader: Reader): { readonly head: Node | undefined; readonly steps: readonly Node[] } | undefined => {
  const callee = unwrapped(childOf(node, 'callee'));
  const args = childrenOf(node, 'arguments');
  if (callee?.type === 'MemberExpression' && callee.computed !== true && nameOf(childOf(callee, 'property')) === 'pipe')
    return { head: childOf(callee, 'object'), steps: args };
  if (callee !== undefined && reader.piped(callee)) return { head: args[0], steps: args.slice(1) };
  return undefined;
};

const optionOrigin = (raw: Node | undefined, reader: Reader, scope: OptionScope): boolean => {
  const node = unwrapped(raw);
  if (node === undefined) return false;
  if (node.type === 'Identifier') return namedBinding(nameOf(node) ?? '', scope)?.origin === true;
  if (node.type === 'YieldExpression' || node.type === 'AwaitExpression') return optionOrigin(childOf(node, 'argument'), reader, scope);
  if (node.type !== 'CallExpression') return false;
  if (producesOption(childOf(node, 'callee'), reader)) return true;
  const piped = pipeline(node, reader);
  return piped !== undefined && producesOption(piped.steps.at(-1), reader);
};

export const resultOrigin = (raw: Node | undefined, reader: Reader, scope: OptionScope): boolean => {
  const node = unwrapped(raw);
  if (node === undefined) return false;
  if (node.type === 'Identifier') return namedBinding(nameOf(node) ?? '', scope)?.result === true;
  if (node.type === 'YieldExpression' || node.type === 'AwaitExpression') return resultOrigin(childOf(node, 'argument'), reader, scope);
  if (node.type === 'ConditionalExpression')
    return resultOrigin(childOf(node, 'consequent'), reader, scope) || resultOrigin(childOf(node, 'alternate'), reader, scope);
  if (reader.member(node) === 'result') return true;
  if (node.type !== 'CallExpression') return false;
  if (reader.member(childOf(node, 'callee')) === 'result') return true;
  const piped = pipeline(node, reader);
  return piped !== undefined && reader.member(piped.steps.at(-1)) === 'result';
};

export const callbackInput = (call: Node, enclosing: Node | undefined, reader: Reader): Node | undefined => {
  if (!['map', 'flatMap'].includes(reader.member(childOf(call, 'callee')) ?? '')) return undefined;
  const args = childrenOf(call, 'arguments');
  if (args.length === 2) return args[0];
  if (args.length !== 1 || enclosing === undefined) return undefined;
  const piped = pipeline(enclosing, reader);
  if (piped === undefined) return undefined;
  const at = piped.steps.findIndex((step) => unwrapped(step) === call);
  if (at === 0) return piped.head;
  if (at > 0 && reader.member(piped.steps[at - 1]) === 'result') return piped.steps[at - 1];
  return undefined;
};

const parsingOf = (raw: Node | undefined, reader: Reader, scope: OptionScope): Parsing | undefined => {
  const node = unwrapped(raw);
  if (node === undefined) return undefined;
  if (node.type === 'Identifier') return namedBinding(nameOf(node) ?? '', scope)?.parsing;
  if (node.type !== 'CallExpression') return undefined;
  const callee = childOf(node, 'callee');
  if (['decodeUnknownResult', 'decodeResult'].includes(reader.member(callee, 'Schema') ?? '')) return 'decoder';
  if (parsingOf(callee, reader, scope) === 'decoder') return 'result';
  const piped = pipeline(node, reader);
  return piped !== undefined && parsingOf(piped.steps.at(-1), reader, scope) === 'decoder' ? 'result' : undefined;
};

const bind = (pattern: Node | undefined, scope: OptionScope, origin = false, result = false, parsing?: Parsing): void => {
  if (pattern === undefined) return;
  if (pattern.type === 'Identifier') scope.names.set(nameOf(pattern) ?? '', { origin, result, parsing, node: pattern });
  else if (pattern.type === 'AssignmentPattern') bind(childOf(pattern, 'left'), scope);
  else if (pattern.type === 'RestElement') bind(childOf(pattern, 'argument'), scope);
  else if (pattern.type === 'ArrayPattern') for (const item of childrenOf(pattern, 'elements')) bind(item, scope);
  else if (pattern.type === 'ObjectPattern')
    for (const item of childrenOf(pattern, 'properties')) bind(childOf(item, item.type === 'RestElement' ? 'argument' : 'value'), scope);
};

export const optionScope = (node: Node, parent: OptionScope, reader: Reader, input?: Node): OptionScope => {
  const scoped =
    FUNCTIONS.has(node.type) ||
    ['BlockStatement', 'FunctionBody', 'CatchClause', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'SwitchStatement'].includes(
      node.type,
    );
  const scope = scoped
    ? {
        parent,
        names: new Map<string, Binding>(),
        handled: new Set<Node>(),
        generator: FUNCTIONS.has(node.type) ? node.generator === true : parent.generator,
      }
    : parent;
  if (node.type === 'BlockStatement' || node.type === 'FunctionBody') {
    for (const statement of childrenOf(node, 'body')) {
      const declaration = childOf(statement, 'declaration') ?? statement;
      if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') bind(childOf(declaration, 'id'), scope);
    }
  }
  if (FUNCTIONS.has(node.type)) {
    bind(childOf(node, 'id'), node.type === 'FunctionDeclaration' ? parent : scope);
    const parameters = childrenOf(node, 'params');
    for (const parameter of parameters) bind(parameter, scope);
    if (resultOrigin(input, reader, parent)) bind(parameters[0], scope, false, true);
  }
  if (node.type === 'CatchClause') bind(childOf(node, 'param'), scope);
  if (node.type === 'VariableDeclaration') {
    for (const declarator of childrenOf(node, 'declarations'))
      bind(
        childOf(declarator, 'id'),
        scope,
        node.kind === 'const' && optionOrigin(childOf(declarator, 'init'), reader, scope),
        node.kind === 'const' && resultOrigin(childOf(declarator, 'init'), reader, scope),
        node.kind === 'const' ? parsingOf(childOf(declarator, 'init'), reader, scope) : undefined,
      );
  }
  return scope;
};

const failureSide = (raw: Node | undefined, reader: Reader, scope: OptionScope): boolean | undefined => {
  const node = unwrapped(raw);
  if (node === undefined) return undefined;
  if (node.type === 'UnaryExpression' && node.operator === '!') {
    const side = failureSide(childOf(node, 'argument'), reader, scope);
    return side === undefined ? undefined : !side;
  }
  if (node.type === 'BinaryExpression' && ['===', '==', '!==', '!='].includes(String(node.operator))) {
    const left = unwrapped(childOf(node, 'left'));
    const right = unwrapped(childOf(node, 'right'));
    const tag = left?.type === 'MemberExpression' ? left : right;
    const value = tag === left ? right : left;
    if (tag?.type !== 'MemberExpression' || tag.computed === true || nameOf(childOf(tag, 'property')) !== '_tag') return undefined;
    const spelling = value?.type === 'Literal' ? value.value : undefined;
    if (spelling === 'None' || spelling === 'Some') {
      if (!optionOrigin(childOf(tag, 'object'), reader, scope)) return undefined;
    } else if (!['Success', 'Failure', 'Left', 'Right'].includes(String(spelling))) return undefined;
    const failure = spelling === 'Failure' || spelling === 'Left' || spelling === 'None';
    return node.operator === '===' || node.operator === '==' ? failure : !failure;
  }
  if (node.type !== 'CallExpression' || childrenOf(node, 'arguments').length !== 1) return undefined;
  const callee = childOf(node, 'callee');
  for (const module of ['Result', 'Exit', 'Either', 'Option']) {
    const member = reader.member(callee, module);
    if (member === undefined) continue;
    if (module === 'Option' && !optionOrigin(childrenOf(node, 'arguments')[0], reader, scope)) return undefined;
    if (['isFailure', 'isLeft', 'isNone'].includes(member)) return true;
    if (['isSuccess', 'isRight', 'isSome'].includes(member)) return false;
  }
  return undefined;
};

const optionInput = (node: Node, enclosing: Node | undefined, reader: Reader, scope: OptionScope): boolean => {
  const args = childrenOf(node, 'arguments');
  if (args.length === 2) return optionOrigin(args[0], reader, scope);
  if (args.length !== 1 || enclosing === undefined) return false;
  const piped = pipeline(enclosing, reader);
  if (piped === undefined) return false;
  const at = piped.steps.findIndex((step) => unwrapped(step) === node);
  return at === 0 ? optionOrigin(piped.head, reader, scope) : at > 0 && producesOption(piped.steps[at - 1], reader);
};

const testedInput = (node: Node): Node | undefined => {
  if (node.type === 'CallExpression' && childrenOf(node, 'arguments').length === 2) return unwrapped(childrenOf(node, 'arguments')[0]);
  const test = unwrapped(childOf(node, 'test') ?? node);
  if (test === undefined) return undefined;
  if (test.type === 'UnaryExpression' && test.operator === '!') {
    const argument = childOf(test, 'argument');
    return argument === undefined ? undefined : testedInput(argument);
  }
  if (test.type === 'LogicalExpression') {
    const left = childOf(test, 'left');
    const right = childOf(test, 'right');
    return (left === undefined ? undefined : testedInput(left)) ?? (right === undefined ? undefined : testedInput(right));
  }
  if (test.type === 'CallExpression') return unwrapped(childrenOf(test, 'arguments')[0]);
  if (test.type !== 'BinaryExpression') return undefined;
  for (const side of ['left', 'right']) {
    const member = unwrapped(childOf(test, side));
    if (member?.type === 'MemberExpression' && nameOf(childOf(member, 'property')) === '_tag') return unwrapped(childOf(member, 'object'));
  }
  return undefined;
};

export const testedBinding = (node: Node): Node | undefined => {
  const input = testedInput(node);
  return input?.type === 'Identifier' ? input : undefined;
};

export const readBinding = (node: Node, parent: Node | undefined, key: string, reader: Reader): Node | undefined => {
  if (
    node.type === 'MemberExpression' &&
    node.computed !== true &&
    ['failure', 'cause', 'error', 'detail', 'left'].includes(nameOf(childOf(node, 'property')) ?? '')
  ) {
    const object = unwrapped(childOf(node, 'object'));
    return object?.type === 'Identifier' ? object : undefined;
  }
  if (node.type !== 'Identifier' || parent === undefined) return undefined;
  if (key === 'id' || key === 'params' || key === 'key' || key === 'param' || key === 'label' || parent.type.startsWith('TS'))
    return undefined;
  if (parent.type === 'MemberExpression' || parent.type.endsWith('Pattern') || parent.type === 'RestElement') return undefined;
  if (parent.type === 'CallExpression') {
    const callee = childOf(parent, 'callee');
    if (['Result', 'Exit', 'Either', 'Option'].some((module) => (reader.member(callee, module) ?? '').startsWith('is'))) return undefined;
  }
  return node;
};

const results = ['Result', 'Exit', 'Either'];

const parsingInput = (node: Node, enclosing: Node | undefined, reader: Reader, scope: OptionScope): boolean => {
  if (node.type === 'ConditionalExpression' || node.type === 'IfStatement') return parsingOf(testedInput(node), reader, scope) === 'result';
  if (node.type !== 'CallExpression') return false;
  const args = childrenOf(node, 'arguments');
  if (args.length === 2) return parsingOf(args[0], reader, scope) === 'result';
  if (args.length !== 1 || enclosing === undefined) return false;
  const piped = pipeline(enclosing, reader);
  if (piped === undefined) return false;
  const at = piped.steps.findIndex((step) => unwrapped(step) === node);
  return at === 0
    ? parsingOf(piped.head, reader, scope) === 'result'
    : at > 0 && parsingOf(piped.steps[at - 1], reader, scope) === 'decoder';
};

export const absenceForm = (node: Node, reader: Reader, scope: OptionScope, enclosing: Node | undefined): Form | undefined => {
  if (parsingInput(node, enclosing, reader, scope)) return undefined;
  if (node.type === 'ConditionalExpression' || node.type === 'IfStatement') {
    const side = failureSide(childOf(node, 'test'), reader, scope);
    if (side === undefined) return undefined;
    const branch = childOf(node, side ? 'consequent' : 'alternate');
    if (node.type === 'ConditionalExpression') return absent(branch) ? 'failureConditional' : undefined;
    return returnsAbsence(branch) ? 'failureReturn' : undefined;
  }
  if (node.type !== 'CallExpression') return undefined;
  const callee = childOf(node, 'callee');
  const args = childrenOf(node, 'arguments');
  if (args.length < 1 || args.length > 2 || args.some((one) => one.type === 'SpreadElement')) return undefined;
  if (results.some((module) => reader.member(callee, module) === 'getOrElse')) return handlerAbsence(args.at(-1)) ? 'getOrElse' : undefined;
  if (reader.member(callee, 'Option') === 'getOrElse')
    return optionInput(node, enclosing, reader, scope) && handlerAbsence(args.at(-1)) ? 'optionGetOrElse' : undefined;
  const option = reader.member(callee, 'Option') === 'match';
  if (
    option
      ? !optionInput(node, enclosing, reader, scope)
      : !['Effect', ...results].some((module) => reader.member(callee, module) === 'match')
  )
    return undefined;
  const cases = unwrapped(args.at(-1));
  if (cases?.type !== 'ObjectExpression') return undefined;
  const properties = childrenOf(cases, 'properties');
  if (properties.some((one) => one.type === 'SpreadElement' || one.computed === true)) return undefined;
  const key = option ? 'onNone' : reader.member(callee, 'Either') === 'match' ? 'onLeft' : 'onFailure';
  const handler = properties.filter((one) => nameOf(childOf(one, 'key')) === key).at(-1);
  return handler !== undefined && handlerAbsence(childOf(handler, 'value')) ? 'match' : undefined;
};
