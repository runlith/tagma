import { codexDescription } from '@runlith/adapter-openai/models/openai';
import { openaiConsoleRegistration, openaiSubscriptionRegistration } from '@runlith/adapter-openai/profiles/openai';
import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { subscriptionAccounts } from '@runlith/llm/oauth/vendor';
import { openaiAccounts } from '@runlith/adapter-openai/oauth/vendors/openai';
import { codexAccounts } from './accounts';
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
    borrows: { provider: codexDescription.id, read: readCodexAccount, renewOnReject: true },
  },
  { ...openaiConsoleRegistration, kind: 'wire', icon },
  {
    ...codexDescription,
    kind: 'harness',
    auth: 'cli',
    icon,
    accounts: codexAccounts,
    accountMode: {
      section: 'codex',
      title: 'Codex',
      default: 'codex',
      id: 'codex',
      label: 'Codex',
      hint: 'Uses the logins of the codex CLI on this machine. Codex keeps and renews the token.',
      missing: "codex isn't installed",
      defaultPlace: '~/.codex',
    },
    environment: (directory) => [
      directory === null ? { _tag: 'Unset', name: 'CODEX_HOME' } : { _tag: 'Set', name: 'CODEX_HOME', value: directory },
      { _tag: 'Unset', name: 'CODEX_API_KEY' },
      { _tag: 'Unset', name: 'CODEX_ACCESS_TOKEN' },
    ],
  },
]);
