const TOOLS: Readonly<Record<string, string>> = {
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  Bash: 'bash',
  BashOutput: 'read_output',
  KillShell: 'stop_command',
  KillBash: 'stop_command',
  Grep: 'grep',
  Glob: 'glob',
  LS: 'ls',
  WebFetch: 'webfetch',
  WebSearch: 'websearch',
  Task: 'spawn_agent',
  Agent: 'spawn_agent',
  Skill: 'load_skill',
  AskUserQuestion: 'ask_user',
};

const NAMES: Readonly<Record<string, string>> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  bash: 'Bash',
  read_output: 'BashOutput',
  stop_command: 'KillShell',
  grep: 'Grep',
  glob: 'Glob',
  ls: 'LS',
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
  spawn_agent: 'Task',
  load_skill: 'Skill',
  ask_user: 'AskUserQuestion',
};

const FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  read: { path: 'file_path' },
  write: { path: 'file_path' },
  edit: { path: 'file_path', oldString: 'old_string', newString: 'new_string', replaceAll: 'replace_all' },
};

export type ToolNaming = { readonly name: string; readonly id: string };

const SERVER_TOOL = /^mcp__(.+?)__(.+)$/u;

export const tagmaTool = (plugin: ToolNaming, name: string): string | null => {
  const own = TOOLS[name];
  if (own !== undefined) return own;
  const prefix = `mcp__plugin_${plugin.name}_`;
  if (name.startsWith(prefix)) {
    const rest = name.slice(prefix.length);
    const at = rest.indexOf('__');
    return at > 0 ? `mcp__${plugin.id}-${rest.slice(0, at)}__${rest.slice(at + 2)}` : null;
  }
  return SERVER_TOOL.test(name) ? name : null;
};

export const claudeTool = (plugin: ToolNaming, name: string): string => {
  const own = NAMES[name];
  if (own !== undefined) return own;
  const server = SERVER_TOOL.exec(name);
  if (server?.[1] !== undefined && server[1].startsWith(`${plugin.id}-`)) {
    return `mcp__plugin_${plugin.name}_${server[1].slice(plugin.id.length + 1)}__${server[2]}`;
  }
  return name;
};

const renamed = (input: unknown, names: Readonly<Record<string, string>> | undefined): unknown => {
  if (names === undefined || input === null || typeof input !== 'object' || Array.isArray(input)) return input;
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [names[key] ?? key, value]));
};

export const claudeInput = (tool: string, input: unknown): unknown => renamed(input, FIELDS[tool]);

export const tagmaInput = (tool: string, input: unknown): unknown => {
  const fields = FIELDS[tool];
  return renamed(
    input,
    fields === undefined ? undefined : Object.fromEntries(Object.entries(fields).map(([own, theirs]) => [theirs, own])),
  );
};
