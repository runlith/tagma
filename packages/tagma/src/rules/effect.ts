import type { BUILTINS } from '@tagma/inspection/builtins';
import type { Builtin } from './rules.js';

export type SwallowedFailuresParams = (typeof BUILTINS)['swallowed-failures']['params']['Encoded'];
export type CallServicesParams = (typeof BUILTINS)['call-services']['params']['Encoded'];

export const Effect = {
  noSwallowedFailures: (params: SwallowedFailuresParams): Builtin<'swallowed-failures', SwallowedFailuresParams> => ({
    builtin: 'swallowed-failures',
    params,
  }),
  servicesOnlyIn: (params: CallServicesParams): Builtin<'call-services', CallServicesParams> => ({ builtin: 'call-services', params }),
};
