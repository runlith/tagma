import { Service } from '@runlith/layer/key';
import type { Right, RightKey } from '@tagma/server/platform/contract/wire/right';
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

export interface Gated<Payload> {
  readonly right?: RightKey;
  readonly offer?: Payload;
}

type Gate = {
  readonly right: (key: RightKey) => Right | undefined;
  readonly allows: (key: RightKey | undefined) => boolean;
  readonly shown: <Payload>(item: { readonly payload: Payload } & Gated<Payload>) => Payload | null;
};

export const gateOf = (access: AccessShape | undefined): Gate => {
  const allows = (key: RightKey | undefined): boolean => {
    if (key === undefined) return true;
    const granted = access?.right(key)?.access;
    return granted === 'read' || granted === 'full';
  };
  return {
    right: (key) => access?.right(key),
    allows,
    shown: (item) => {
      if (item.right === undefined || allows(item.right)) return item.payload;
      return access?.right(item.right)?.access === 'none' ? (item.offer ?? null) : null;
    },
  };
};
