import { GateRefusal } from '../platform/contract/wire/refusal.js';

export const READ_PLUGINS = 'read_plugins answers each plugin’s process state and why it stopped';

type CallFailure = {
  readonly _tag: 'McpCallFailed' | 'McpTimedOut' | 'McpConnectFailed' | 'McpNotConnected' | 'McpNeedsSignIn';
  readonly message: string;
};

export const refusal = <Code extends string>(code: Code, reason: string): GateRefusal<Code> =>
  new GateRefusal(code, reason, code === 'plugin-unavailable' ? [READ_PLUGINS] : ['try again', READ_PLUGINS]);

export const unreadable = (failure: { readonly message: string }) => new GateRefusal('plugin-unavailable', failure.message, [READ_PLUGINS]);

export const callRefusal = (failure: CallFailure): GateRefusal<'plugin-call-failed' | 'plugin-unavailable'> => {
  switch (failure._tag) {
    case 'McpCallFailed':
    case 'McpTimedOut':
      return refusal('plugin-call-failed', failure.message);
    case 'McpConnectFailed':
    case 'McpNotConnected':
    case 'McpNeedsSignIn':
      return refusal('plugin-unavailable', failure.message);
  }
};
