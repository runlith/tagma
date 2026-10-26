import type { HooksWrite } from './hookInstall.js';
import type { RepoInstall, UserInstall } from './skillInstall.js';
import type { McpDeclarationWrite } from '../../installation/contract/wire/install.js';
import type { UpgradeEntry } from './upgrade.js';

function renderHooksWrite(hook: HooksWrite, indent = ''): string[] {
  return [`${indent}hooks ${hook.write} ${hook.path}`, ...(hook.deferred ?? []).map((reason) => `${indent}  deferred: ${reason}`)];
}

function renderMcpWrite(mcp: McpDeclarationWrite, indent = ''): string[] {
  const approved = mcp.approved === undefined ? '' : ` — approval ${mcp.approved}`;
  return [
    `${indent}mcp ${mcp.harness} ${mcp.write} ${mcp.path}${approved}`,
    ...(mcp.detail === undefined ? [] : [`${indent}  ${mcp.detail}`]),
  ];
}

export function renderInstallResult(installed: RepoInstall): string[] {
  return [
    `skill ${installed.skill.target}`,
    `link ${installed.link}`,
    `law ${installed.agents.write} ${installed.agents.path}`,
    `claude ${installed.claude.write} ${installed.claude.path}`,
    ...installed.hooks.flatMap((hook) => renderHooksWrite(hook)),
    ...installed.mcp.flatMap((mcp) => renderMcpWrite(mcp)),
  ];
}

export function renderUserInstallResult(served: UserInstall, project: string): string[] {
  return [
    `skill ${served.skill.target}`,
    ...served.hooks.flatMap((hook) => renderHooksWrite(hook)),
    `repository untouched — ${project} carries no Tagma artifact`,
  ];
}

export function renderUpgradeResult(done: readonly UpgradeEntry[]): string[] {
  return done.flatMap((entry) => {
    if (entry.failed !== undefined) return [`${entry.place} — failed: ${entry.failed}`];
    if (entry.skipped !== undefined) return [`${entry.place} — ${entry.skipped}, skipped`];
    return [
      `${entry.place}`,
      `  skill ${entry.skill}`,
      ...(entry.law === undefined ? [] : [`  law ${entry.law}`]),
      ...(entry.hooks ?? []).flatMap((hook) => renderHooksWrite(hook, '  ')),
      ...(entry.mcp ?? []).flatMap((mcp) => renderMcpWrite(mcp, '  ')),
    ];
  });
}
