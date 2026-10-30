import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { opencode } from './harness/opencode.js';

export const adapter = defineAdapter(() => [opencode]);
