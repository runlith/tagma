import { claudeCodeDescription } from '@runlith/adapter-anthropic/models/anthropic';
import { anthropicConsoleRegistrations } from '@runlith/adapter-anthropic/profiles/anthropic';
import { type AccountEnvironment, defineAdapter } from '@runlith/tagma/adapter/provider';
import { claudeAccounts } from './accounts';
import { icon } from './icon';

const SIGNED_ELSEWHERE = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_SECURESTORAGE_CONFIG_DIR',
  'CLAUDECODE',
];

const claudeEnvironment = (directory: string | null): readonly AccountEnvironment[] => [
  directory === null ? { _tag: 'Unset', name: 'CLAUDE_CONFIG_DIR' } : { _tag: 'Set', name: 'CLAUDE_CONFIG_DIR', value: directory },
  ...SIGNED_ELSEWHERE.map((name) => ({ _tag: 'Unset' as const, name })),
];

export const adapter = defineAdapter(({ product }) => [
  ...anthropicConsoleRegistrations(product).map((registration) => ({ ...registration, kind: 'wire' as const, icon })),
  {
    ...claudeCodeDescription,
    kind: 'harness',
    auth: 'cli',
    icon,
    accounts: claudeAccounts,
    environment: claudeEnvironment,
    accountMode: {
      section: 'claude',
      title: 'Claude',
      default: 'claude',
      id: 'claude',
      label: 'Claude',
      hint: 'Uses the logins of Claude Code on this machine. Claude Code keeps and renews the token.',
      missing: "Claude Code isn't installed",
      defaultPlace: '~/.claude',
    },
  },
]);
