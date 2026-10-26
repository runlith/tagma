import type { Phase, PoolDeclaration } from '@runlith/held/Capacity';
import { figures, HEAVY, heavyPool, type Machine } from '../../../platform/contract/service/capacity.js';

export const OPENS = 'graph-opens';

const OPEN_ENVELOPE = 512 * 1024 ** 2;

export const opensPool = (machine: Machine): PoolDeclaration => {
  const heavy = heavyPool(machine);
  const units = Math.max(1, Math.min(Math.ceil(heavy.limits.call / 2), Math.floor(figures(machine).serverReservations / OPEN_ENVELOPE)));
  return { name: OPENS, units, limits: { call: units, background: Math.max(1, Math.floor(units / 2)) } };
};

const opening = (klass: Phase['class']): Phase => ({
  name: 'GraphPool.open',
  class: klass,
  needs: [
    { pool: HEAVY, units: 1 },
    { pool: OPENS, units: 1 },
  ],
});

export const OPEN_FOR_CALL: Phase = opening('call');

export const OPEN_IN_BACKGROUND: Phase = opening('background');

export const MIRROR_RETIREMENT: Phase = {
  name: 'Mirrors.retire',
  class: 'background',
  needs: [
    { pool: HEAVY, units: 1 },
    { pool: 'graph-mirrors', units: 1 },
  ],
};

export const graphPools = (machine: Machine): readonly PoolDeclaration[] => [
  opensPool(machine),
  { name: 'graph-mirrors', units: 1, limits: { call: 1, background: 1 } },
];
