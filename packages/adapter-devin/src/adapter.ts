import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { devin } from './harness/devin';

export const adapter = defineAdapter(() => [devin]);
