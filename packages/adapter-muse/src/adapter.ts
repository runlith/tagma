import { museConsoleRegistration } from './profiles/muse';
import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { icon } from './icon';

export const adapter = defineAdapter(({ product }) => [
  { ...museConsoleRegistration(product), kind: 'wire', icon, keyHint: 'Paste a Model API key from the Meta developer console.' },
]);
