import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

import { withOverrides } from '@runlith/testing/overrides';

import { createOverlaySignals, type OverlaySignals } from './overlay-signals.js';
import type { Overlay, OverlayKeyClass } from './Overlay.svelte.js';
import type { DialogHandle } from './types.js';

export type HandleRecord = {
  props: Record<string, unknown>;
  open: boolean;
  result: unknown;
  presentation: Record<string, unknown>;
};

function makeHandle(id: string): { handle: DialogHandle; record: HandleRecord } {
  const signals = createOverlaySignals<unknown>();
  signals.present();
  const record: HandleRecord = { props: {}, open: true, result: undefined, presentation: {} };

  return {
    record,
    handle: {
      id,
      close: (result?: unknown) => {
        record.result = result;
        record.open = false;
        signals.end(result);
      },
      update: (props: Record<string, unknown>) => {
        record.props = props;
      },
      reopen: () => {
        record.open = true;
        return true;
      },
      apply: (options: Record<string, unknown>) => {
        record.presentation = options;
      },
      presented: signals.presented,
      closed: signals.closed,
    },
  };
}

export function makeDialogHandle(overrides: Partial<DialogHandle> = {}): DialogHandle {
  return withOverrides(makeHandle('test-dialog').handle, overrides);
}

export function makeDialogHandleWithRecord(overrides: Partial<DialogHandle> = {}): {
  handle: DialogHandle;
  record: HandleRecord;
} {
  const { handle, record } = makeHandle('test-dialog');
  return { handle: withOverrides(handle, overrides), record };
}

export type OpenedOverlay = {
  readonly id: string;
  readonly as: string;
  props: Record<string, unknown>;
  readonly present: () => Promise<void>;
  readonly end: (result?: unknown) => void;
};

export type OverlayStub = {
  overlay: Overlay;
  opened: OpenedOverlay[];
  readonly raised: string[];
  closed: string[];
};

type OverlayOpenHandle = {
  presented: Promise<void>;
  closed: Promise<unknown>;
  close: (result?: unknown) => void;
};

export type OverlayStubOptions = {
  presentOnOpen?: boolean;
};

export function makeOverlay(options: OverlayStubOptions = {}): OverlayStub {
  const opened: OpenedOverlay[] = [];
  const closed: string[] = [];
  const live = new SvelteMap<string, { signals: OverlaySignals<unknown>; handle: OverlayOpenHandle; entry: OpenedOverlay }>();

  const open = (key: OverlayKeyClass<string, Record<string, never>>, props: Record<string, unknown>) => {
    const existing = live.get(key.id);
    if (existing) {
      existing.entry.props = props;
      return existing.handle;
    }

    const signals = createOverlaySignals<unknown>();
    const entry: OpenedOverlay = {
      id: key.id,
      as: key.as,
      props,
      present: () => {
        signals.present();
        return signals.presented;
      },
      end: (result?: unknown) => {
        live.delete(key.id);
        signals.end(result);
      },
    };
    const handle = handleOf(signals, key.id);
    live.set(key.id, { signals, handle, entry });
    opened.push(entry);

    if (options.presentOnOpen) signals.present();

    return handle;
  };

  const handleOf = (signals: OverlaySignals<unknown>, id: string): OverlayOpenHandle => ({
    presented: signals.presented,
    closed: signals.closed,
    close: (result?: unknown) => {
      closed.push(id);
      live.delete(id);
      signals.end(result);
    },
  });

  const overlay = {
    open,
    close: (key: { readonly id: string }, result?: unknown) => {
      closed.push(key.id);
      const request = live.get(key.id);
      live.delete(key.id);
      request?.signals.end(result);
    },
    isOpen: (key: { readonly id: string }) => live.has(key.id),
    peekOpen: (key: { readonly id: string }) => untrack(() => live.has(key.id)),
    stateOf: (id: string) => (live.has(id) ? 'active' : undefined),
    binds: () => true,
    declaredHere: () => [],
    anyOf: (...keys: readonly { readonly id: string }[]) => ({
      get current() {
        return keys.some((key) => live.has(key.id));
      },
      name: 'Overlay.anyOf',
      holdsUntilMs: undefined,
    }),
    snapshot: () => ({
      overlays: [...live.keys()].map((id) => ({
        id,
        as: 'dialog',
        state: 'active',
        arbitrated: false,
        priority: 0,
        order: 0,
        preloading: false,
        blockedBy: [],
        heldBy: [],
      })),
    }),
  } as unknown as Overlay;

  return {
    overlay,
    opened,
    get raised() {
      return opened.map((entry) => entry.id);
    },
    closed,
  };
}
