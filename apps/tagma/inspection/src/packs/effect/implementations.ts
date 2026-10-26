import type { ImplementationsOf } from '../../core/node/reading';
import { callServices } from './call-services/implementation';
import type { effect } from './manifest';
import { swallowedFailures } from './swallowed-failures/implementation';

export const implementations: ImplementationsOf<typeof effect> = {
  'call-services': callServices,
  'swallowed-failures': swallowedFailures,
};
