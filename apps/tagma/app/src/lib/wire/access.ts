import { type Optional, Service } from '@runlith/layer/key';
import type { Right, RightKey } from '@tagma/server/platform/contract/wire/right';
import type { Refusal } from './refusal.js';
import type { Act } from './told.js';

interface AccessShape {
  right(key: RightKey): Right | undefined;
}

export class Access extends Service<AccessShape>()('Access', { tier: 'app' }) {}

type Hint = { readonly note?: string; readonly act?: Act };

export interface AccessHintShape {
  hint(right: Right): Hint;
}

export class AccessHint extends Service<AccessHintShape>()('AccessHint', { tier: 'app' }) {}

export const hinted = (refusal: Refusal, hints: AccessHintShape | undefined): Refusal =>
  hints === undefined || refusal.right === undefined ? refusal : refusal.hinted(hints.hint(refusal.right));

export interface Gated<Payload> {
  readonly right?: RightKey;
  readonly offer?: Payload;
}

type Use = 'read' | 'write';

type Gate = {
  readonly right: (key: RightKey) => Right | undefined;
  readonly allows: (key: RightKey | undefined) => boolean;
  readonly shown: <Payload>(item: { readonly payload: Payload } & Gated<Payload>) => Payload | null;
};

export const gatedBy = <Item extends { readonly payload: unknown } & Gated<unknown>>(use: Use) =>
  function* (): Generator<Optional, (item: Item) => Item | null, unknown> {
    const gate = gateOf(yield* Access.optional(), use);
    return (item) => {
      const payload = gate.shown(item);
      if (payload === null) return null;
      return payload === item.payload ? item : ({ ...item, payload } as Item);
    };
  };

export const gateOf = (access: AccessShape | undefined, use: Use): Gate => {
  const allows = (key: RightKey | undefined): boolean => {
    if (key === undefined) return true;
    const granted = access?.right(key)?.access;
    return granted === 'full' || (granted === 'read' && use === 'read');
  };
  return {
    right: (key) => access?.right(key),
    allows,
    shown: (item) => {
      if (item.right === undefined || allows(item.right)) return item.payload;
      return access?.right(item.right) === undefined ? null : (item.offer ?? null);
    },
  };
};
