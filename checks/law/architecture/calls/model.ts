import type { Capability } from './params';

export type Act = 'request' | 'ask' | 'row';

export type Fn = {
  readonly params: readonly (Value | undefined)[];
  returns: Value | undefined;
  readonly analyze: () => void;
};

export type Value =
  | { readonly k: 'cap'; readonly cap: Capability }
  | { readonly k: 'service'; readonly cap: Capability }
  | { readonly k: 'method'; readonly cap: Capability; readonly name: string }
  | { readonly k: 'array'; readonly of: Value }
  | { readonly k: 'object'; readonly props: Map<string, Value> }
  | { readonly k: 'fn'; readonly fn: Fn }
  | { readonly k: 'module'; readonly path: string }
  | { readonly k: 'wrap' };

export type Method = { readonly act: Act | null; readonly returns: Value | null };

const cap = (name: Capability): Value => ({ k: 'cap', cap: name });

const REQUEST: Method = { act: 'request', returns: cap('request') };
const ASK: Method = { act: 'ask', returns: null };
const ASIDE: Method = { act: null, returns: cap('aside') };

export const METHODS: Readonly<Record<Capability, Readonly<Record<string, Method>>>> = {
  access: { request: REQUEST, decide: { act: 'request', returns: null } },
  requester: { request: REQUEST },
  request: {
    stream: { act: 'request', returns: null },
    text: { act: 'request', returns: null },
    object: { act: 'request', returns: null },
  },
  asides: { ask: ASK, of: ASIDE },
  aside: { ask: ASK },
  asks: { held: ASIDE },
  adapters: {
    find: { act: 'row', returns: cap('row') },
    row: { act: 'row', returns: cap('row') },
    all: { act: 'row', returns: { k: 'array', of: cap('row') } },
  },
  row: {},
};

const OWNER: Readonly<Record<Capability, string>> = {
  access: 'ModelAccess',
  requester: 'ModelRequester',
  request: 'ModelRequest',
  asides: 'ThreadAsides',
  aside: 'AgentAside',
  asks: 'ThreadAsks',
  adapters: 'HarnessAdapters',
  row: 'HarnessAdapter',
};

export const labelOf = (value: Capability, name: string): string => `${OWNER[value]}.${name}`;

export const rowBearing = (value: Value | undefined): boolean =>
  value !== undefined && ((value.k === 'cap' && value.cap === 'row') || (value.k === 'array' && rowBearing(value.of)));

export const capable = (value: Value | undefined, depth = 0): boolean => {
  if (value === undefined || depth > 4) return false;
  switch (value.k) {
    case 'cap':
    case 'service':
    case 'method':
      return true;
    case 'array':
      return capable(value.of, depth + 1);
    case 'object':
      return [...value.props.values()].some((one) => capable(one, depth + 1));
    case 'fn':
      value.fn.analyze();
      return value.fn.params.some((one) => capable(one, depth + 1)) || capable(value.fn.returns, depth + 1);
    default:
      return false;
  }
};

export const describe = (value: Value | undefined, depth = 0): string => {
  if (value === undefined || depth > 4) return '-';
  switch (value.k) {
    case 'cap':
      return `c:${value.cap}`;
    case 'service':
      return `s:${value.cap}`;
    case 'method':
      return `m:${value.cap}.${value.name}`;
    case 'array':
      return `[${describe(value.of, depth + 1)}]`;
    case 'object':
      return `{${[...value.props]
        .filter(([, one]) => capable(one))
        .map(([name, one]) => `${name}:${describe(one, depth + 1)}`)
        .sort()
        .join(',')}}`;
    case 'fn':
      value.fn.analyze();
      return `(${value.fn.params.map((one) => describe(one, depth + 1)).join(',')})=>${describe(value.fn.returns, depth + 1)}`;
    case 'module':
      return 'mod';
    case 'wrap':
      return 'wrap';
  }
};
