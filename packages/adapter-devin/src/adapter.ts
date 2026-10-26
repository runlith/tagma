import { devinDescription } from './models/devin';
import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { icon } from './icon';

export const adapter = defineAdapter(() => [{ ...devinDescription, kind: 'harness', auth: 'cli', icon, environment: () => [] }]);
