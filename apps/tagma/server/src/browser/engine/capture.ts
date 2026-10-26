import { Ring } from '@runlith/cdp/ring';
import { type CdpEvent, eventParams } from '@runlith/cdp/session';
import type { Protocol } from 'devtools-protocol';
import { Effect } from 'effect';
import { ENTRY_CHARS, type ConsoleEntry, type ConsoleLevel, type NetworkEntry } from '../contract/wire/rows.js';
import type { Attached, Paged } from './drive.js';

const CONSOLE_BYTES = 512 * 1024;
const NETWORK_BYTES = 512 * 1024;
const REQUESTS_HELD = 4_096;

export type Request = { readonly seq: number; readonly started: number; readonly id: string; readonly target: string | undefined };

const weighConsole = (entry: ConsoleEntry): number => 96 + entry.text.length + (entry.url?.length ?? 0);
const weighNetwork = (entry: NetworkEntry): number => 128 + entry.url.length + (entry.failure?.length ?? 0);

export const consoleRing = (): Ring<ConsoleEntry> => new Ring(CONSOLE_BYTES, weighConsole);
export const networkRing = (): Ring<NetworkEntry> => new Ring(NETWORK_BYTES, weighNetwork);

const clip = (text: string): string => (text.length > ENTRY_CHARS ? `${text.slice(0, ENTRY_CHARS)}…` : text);

const CONSOLE_LEVEL: Readonly<Record<string, ConsoleLevel>> = {
  error: 'error',
  assert: 'error',
  warning: 'warning',
  info: 'info',
  debug: 'debug',
  verbose: 'debug',
};

const said = (value: Protocol.Runtime.RemoteObject): string =>
  value.value !== undefined
    ? typeof value.value === 'string'
      ? value.value
      : JSON.stringify(value.value)
    : (value.unserializableValue ?? value.description ?? value.type);

const targetOf = (attached: Attached, child: string | undefined): string | undefined =>
  child === undefined ? undefined : (attached.children.get(child) ?? child);

const requestKey = (attached: Attached, child: string | undefined, id: string): string => {
  const target = targetOf(attached, child);
  return target === undefined ? id : `${target}:${id}`;
};

const pushConsole = (state: Paged, entry: Omit<ConsoleEntry, 'seq'>) => state.console.push({ ...entry, seq: 0 });

export const capture = Effect.fnUntraced(function* (state: Paged, attached: Attached, event: CdpEvent) {
  switch (event.method) {
    case 'Runtime.consoleAPICalled': {
      const called = yield* eventParams('Runtime.consoleAPICalled', event);
      const top = called.stackTrace?.callFrames[0];
      pushConsole(state, {
        level: CONSOLE_LEVEL[called.type] ?? 'log',
        source: 'console',
        text: clip(called.args.map(said).join(' ')),
        url: top?.url || null,
        line: top === undefined ? null : top.lineNumber + 1,
        at: new Date(called.timestamp).toISOString(),
      });
      return;
    }
    case 'Runtime.exceptionThrown': {
      const { exceptionDetails: details, timestamp } = yield* eventParams('Runtime.exceptionThrown', event);
      pushConsole(state, {
        level: 'error',
        source: 'exception',
        text: clip(details.exception?.description ?? details.text),
        url: details.url ?? null,
        line: details.lineNumber + 1,
        at: new Date(timestamp).toISOString(),
      });
      return;
    }
    case 'Log.entryAdded': {
      const { entry } = yield* eventParams('Log.entryAdded', event);
      pushConsole(state, {
        level: CONSOLE_LEVEL[entry.level] ?? 'log',
        source: entry.source,
        text: clip(entry.text),
        url: entry.url ?? null,
        line: entry.lineNumber === undefined ? null : entry.lineNumber + 1,
        at: new Date(entry.timestamp).toISOString(),
      });
      return;
    }
    case 'Network.requestWillBeSent': {
      const sent = yield* eventParams('Network.requestWillBeSent', event);
      const key = requestKey(attached, event.child, sent.requestId);
      if (state.requests.has(key)) return;
      const seq = state.network.push({
        seq: 0,
        request: key,
        method: sent.request.method,
        url: clip(sent.request.url),
        type: sent.type ?? 'Other',
        status: null,
        mime: null,
        bytes: null,
        failure: null,
        at: new Date(sent.wallTime * 1000).toISOString(),
        ms: null,
      });
      state.requests.set(key, { seq, started: sent.timestamp, id: sent.requestId, target: targetOf(attached, event.child) });
      if (state.requests.size > REQUESTS_HELD) state.requests.delete(state.requests.keys().next().value!);
      return;
    }
    case 'Network.responseReceived': {
      const received = yield* eventParams('Network.responseReceived', event);
      const known = state.requests.get(requestKey(attached, event.child, received.requestId));
      if (known !== undefined)
        state.network.update(known.seq, (entry) => ({
          ...entry,
          status: received.response.status,
          mime: received.response.mimeType,
          type: received.type,
        }));
      return;
    }
    case 'Network.loadingFinished': {
      const finished = yield* eventParams('Network.loadingFinished', event);
      const known = state.requests.get(requestKey(attached, event.child, finished.requestId));
      if (known === undefined) return;
      state.network.update(known.seq, (entry) => ({
        ...entry,
        bytes: finished.encodedDataLength,
        ms: Math.round((finished.timestamp - known.started) * 1000),
      }));
      return;
    }
    case 'Network.loadingFailed': {
      const failed = yield* eventParams('Network.loadingFailed', event);
      const known = state.requests.get(requestKey(attached, event.child, failed.requestId));
      if (known === undefined) return;
      state.network.update(known.seq, (entry) => ({
        ...entry,
        failure: failed.canceled === true ? 'canceled' : clip(failed.errorText),
        ms: Math.round((failed.timestamp - known.started) * 1000),
      }));
      return;
    }
  }
});
