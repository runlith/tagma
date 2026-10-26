import type { Pack } from '../../core/rule';
import { callServices } from './call-services/declaration';
import { swallowedFailures } from './swallowed-failures/declaration';

export const effect = {
  id: 'effect',
  uses: { packages: ['effect'] },
  rules: [callServices, swallowedFailures],
} as const satisfies Pack;
