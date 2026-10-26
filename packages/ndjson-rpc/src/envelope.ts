export type Fault = { readonly code: number; readonly message: string; readonly data?: unknown };

export type Envelope =
  | { readonly _tag: 'Request'; readonly id: string | number; readonly method: string; readonly params?: unknown }
  | { readonly _tag: 'Notification'; readonly method: string; readonly params?: unknown }
  | { readonly _tag: 'Result'; readonly id: string | number; readonly result: unknown }
  | { readonly _tag: 'Error'; readonly id: string | number | null; readonly error: Fault };

export type Malformed = { readonly _tag: 'Malformed'; readonly problem: string; readonly excerpt: string };

export type Classified = Envelope | Malformed;

const EXCERPT = 400;
const BLANK = /^\s*$/;

const malformed = (problem: string, text: string): Malformed => ({ _tag: 'Malformed', problem, excerpt: text.slice(0, EXCERPT) });

const carried = (message: Record<string, unknown>): { readonly params?: unknown } => ({ params: message.params });

const fault = (value: unknown): Fault | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const error = value as Record<string, unknown>;
  if (typeof error.code !== 'number' || typeof error.message !== 'string') return undefined;
  return { code: error.code, message: error.message, data: error.data };
};

const answered = (message: Record<string, unknown>, text: string): Classified => {
  const id = message.id;
  if ('error' in message) {
    const error = fault(message.error);
    if (error === undefined) return malformed('an error response without a numeric code and message', text);
    if (typeof id !== 'string' && typeof id !== 'number' && id !== null) {
      return malformed('an error response whose id is not a string, number or null', text);
    }
    return { _tag: 'Error', id, error };
  }
  if (typeof id !== 'string' && typeof id !== 'number') return malformed('a response whose id is not a string or number', text);
  if (!('result' in message)) return malformed('a response with neither result nor error', text);
  return { _tag: 'Result', id, result: message.result };
};

export const classify = (text: string): Classified | null => {
  if (BLANK.test(text)) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return malformed('a line that is not JSON', text);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return malformed('a line that is not a JSON-RPC message', text);
  const message = value as Record<string, unknown>;
  const method = message.method;
  if (!('id' in message)) {
    if (typeof method !== 'string') return malformed('a line with neither id nor method', text);
    return { _tag: 'Notification', method, ...carried(message) };
  }
  if (typeof method !== 'string') return answered(message, text);
  const id = message.id;
  if (typeof id !== 'string' && typeof id !== 'number') return malformed('a request whose id is not a string or number', text);
  return { _tag: 'Request', id, method, ...carried(message) };
};

const wire = (envelope: Envelope): Record<string, unknown> => {
  switch (envelope._tag) {
    case 'Request':
      return {
        jsonrpc: '2.0',
        id: envelope.id,
        method: envelope.method,
        params: envelope.params,
      };
    case 'Notification':
      return { jsonrpc: '2.0', method: envelope.method, params: envelope.params };
    case 'Result':
      return { jsonrpc: '2.0', id: envelope.id, result: envelope.result };
    case 'Error':
      return { jsonrpc: '2.0', id: envelope.id, error: envelope.error };
  }
};

export const frame = (envelope: Envelope): string => `${JSON.stringify(wire(envelope))}\n`;
