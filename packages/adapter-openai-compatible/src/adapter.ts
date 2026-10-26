import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { instanceOf, providerOf } from './instance';
import { settings } from './settings';

export const adapter = defineAdapter(
  ({ instances }) =>
    instances.flatMap((instance) => {
      const configured = instanceOf(instance, instance.secrets);
      const provider = configured === null ? null : providerOf(configured);
      return provider === null ? [] : [provider];
    }),
  settings,
);
