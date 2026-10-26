import type { Behaviour } from '../../../graph/contract/service/behaviours.js';
import { ENFORCED, LAW } from '../../../graph/contract/wire/tags/lawContracts.js';
import { DELIVERIES } from '../../../graph/contract/wire/tags/law.js';
import { MODULE, MODULE_SLOTS } from '../../../graph/contract/wire/tags/moduleContract.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';

const SPELLED = [...DELIVERIES].sort().join(',');

export const law: Behaviour = {
  id: LAW,
  slots: { enabled: {}, delivery: { kind: 'enum', optional: true } },
  words: {},
  actions: [
    { op: 'set_rule_enabled', writes: ['enabled'] },
    { op: 'set_rule_delivery', writes: ['delivery'] },
  ],
  requires: [],
  fromRoles: ({ law: field, delivery }) => {
    if (field === undefined) return null;
    const slots: Record<string, string> = { enabled: field };
    if (delivery !== undefined) slots.delivery = delivery;
    return { slots, words: {} };
  },
  check: ({ from, binding }, over) => {
    const field = binding.slots.delivery;
    if (field === undefined) return null;
    const type = over.fields[field];
    const values = typeof type === 'object' && type.type === 'enum' ? [...type.values].sort().join(',') : '';
    return values === SPELLED
      ? null
      : new GateRefusal(
          'tag-incoherent',
          `#${from} binds ${LAW} delivery to "${field}", which does not hold exactly ${DELIVERIES.join(' and ')}`,
          [`declare #${from}.fields.${field} as {type: "enum", values: ["${DELIVERIES.join('", "')}"]}`],
        );
  },
};

export const enforced: Behaviour = {
  id: ENFORCED,
  slots: { enforcement: { kind: { schema: 'lawEnforcement' } } },
  words: {},
  actions: [{ op: 'enforce_rule', writes: ['enforcement'] }],
  requires: [LAW],
  fromRoles: ({ enforcement: field }) => (field === undefined ? null : { slots: { enforcement: field }, words: {} }),
};

export const moduleBoundaries: Behaviour = {
  id: MODULE,
  slots: { id: { kind: 'string' }, entries: { kind: { schema: 'moduleEntries' } }, order: { kind: { schema: 'moduleOrder' } } },
  words: {},
  actions: [{ op: 'set_module', writes: MODULE_SLOTS }],
  requires: [],
};

export const lawBehaviours: readonly Behaviour[] = [law, enforced, moduleBoundaries];
