import { xaiConsoleRegistration } from './profiles/xai';
import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { icon } from './icon';
import { grok } from './harness/grok';

export const adapter = defineAdapter(() => [{ ...xaiConsoleRegistration, kind: 'wire', icon }, grok]);
