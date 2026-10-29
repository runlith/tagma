import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { Predicate } from 'effect';

type Held = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Held => Predicate.isObject(value) && !Array.isArray(value);

const approved = (grants: unknown): unknown => {
  if (!Array.isArray(grants)) return grants;
  const formed = grants.map((grant: unknown) =>
    typeof grant === 'string' && grant.startsWith('plugin__') ? `app__${grant.slice(8)}` : grant,
  );
  return formed.every((grant, at) => grant === grants[at]) ? grants : formed;
};

const bound = (bindings: unknown): unknown => {
  if (!isRecord(bindings) || bindings.plugin === undefined) return bindings;
  const { plugin, ...rest } = bindings;
  return rest.app === undefined ? { ...rest, app: plugin } : rest;
};

export const appBindingForm: ThreadFormStep = {
  name: '20261029173200_app_binding',
  samples: { meta: { mandate: { id: 't', bindings: { plugin: 'board' }, approves: ['ask_user', 'plugin__board__deal'] } } },
  meta: (meta) => {
    const mandate = meta.mandate;
    if (!isRecord(mandate)) return null;
    const bindings = bound(mandate.bindings);
    const approves = approved(mandate.approves);
    if (bindings === mandate.bindings && approves === mandate.approves) return null;
    const next: Record<string, unknown> = { ...mandate };
    if (bindings !== mandate.bindings) next.bindings = bindings;
    if (approves !== mandate.approves) next.approves = approves;
    return { ...meta, mandate: next };
  },
};
