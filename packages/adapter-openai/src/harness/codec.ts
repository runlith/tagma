import { commandGroup, eventOutput, toolOutput, type HookCodec } from '@runlith/tagma/adapter/hook';

export const codexCodec: HookCodec = {
  file: {
    keys: {},
    events: ['hooks'],
    holes: true,
    trust: {
      home: 'CODEX_HOME',
      folder: '.codex',
      file: 'config.toml',
      table: 'hooks.state',
      key: (filePath, event, group, handler) =>
        `${filePath}:${event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}:${group}:${handler}`,
    },
    entry: commandGroup,
  },
  permission: ({ allowed, words }) =>
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: allowed ? 'allow' : 'deny', message: words } },
    }),
  context: eventOutput('SessionStart'),
  tool: toolOutput('PreToolUse', 'PostToolUse'),
  prompt: eventOutput('UserPromptSubmit'),
};
