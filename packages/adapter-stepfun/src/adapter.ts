import { stepfunRegistrations } from '@runlith/adapter-stepfun/profiles/stepfun';
import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { icon } from './icon';

export const adapter = defineAdapter(({ product }) =>
  stepfunRegistrations(product).map((registration) => ({
    ...registration,
    kind: 'wire' as const,
    icon,
    keyHint: 'Paste an API key from the StepFun console. Calls spend the account\u2019s Step Plan credits, not its pay-as-you-go balance.',
    quotaFromReplies: true as const,
  })),
);
