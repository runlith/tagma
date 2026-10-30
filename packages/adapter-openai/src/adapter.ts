import { openaiConsoleRegistration, openaiSubscriptionRegistration } from '@runlith/adapter-openai/profiles/openai';
import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { subscriptionAccounts } from '@runlith/llm/oauth/vendor';
import { openaiAccounts } from '@runlith/adapter-openai/oauth/vendors/openai';
import { codex } from './harness/codex';
import { readCodexAccount } from './oauth/cli/codex';
import { icon } from './icon';

export const adapter = defineAdapter(({ product }) => [
  {
    ...openaiSubscriptionRegistration(product),
    kind: 'wire',
    icon,
    accountMode: {
      section: 'codex',
      title: 'Codex',
      default: 'codex',
      id: 'tagma',
      label: 'Tagma',
      hint: 'Tagma signs in through the browser and keeps the token itself. The codex CLI is not needed.',
      signInLabel: 'Sign in with ChatGPT',
    },
    accounts: subscriptionAccounts(openaiAccounts),
    borrows: { provider: codex.id, read: readCodexAccount, renewOnReject: true },
  },
  { ...openaiConsoleRegistration, kind: 'wire', icon },
  codex,
]);
