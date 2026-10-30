import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { gemini } from './harness/gemini';

export const adapter = defineAdapter(() => [gemini]);
