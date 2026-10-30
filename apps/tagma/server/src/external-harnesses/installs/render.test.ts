import { describe, expect, test } from 'bun:test';
import type { HooksWrite } from './hookInstall.js';
import type { McpDeclarationWrite } from '../../installation/contract/wire/install.js';
import { renderInstallResult, renderUpgradeResult } from './render.js';

describe('install and upgrade hook results', () => {
  const hook = (over: Partial<HooksWrite> = {}): HooksWrite => ({ path: '/r/.claude/settings.json', write: 'updated', ...over });

  test('a deferred hook carries its reasons on the lines of its own file, in install and upgrade', () => {
    const reason = 'SessionStart: our hook stands under your matcher "x"';
    const hooks = [hook({ deferred: [reason] }), hook({ path: '/r/.codex/hooks.json', write: 'current' })];
    const installed = {
      skill: { target: '/r/.agents/skills/tagma', files: [] },
      links: ['/r/.claude/skills/tagma'],
      agents: { path: '/r/AGENTS.md', write: 'created' as const },
      instructions: [{ path: '/r/CLAUDE.md', write: 'absent' as const }],
      hooks,
      mcp: [],
    };

    for (const lines of [
      renderInstallResult(installed),
      renderUpgradeResult([{ place: 'repo', skill: '/r/.agents/skills/tagma', hooks }]),
    ]) {
      const at = lines.findIndex((line) => line.includes('/r/.claude/settings.json'));
      expect(at).toBeGreaterThan(-1);
      expect(lines.slice(at, at + 2).join('\n')).toContain(reason);
    }
  });

  test('an MCP declaration and the reason one was refused reach the operator from install and upgrade alike', () => {
    const mcp: McpDeclarationWrite[] = [
      { harness: 'claude-code', path: '/r/.mcp.json', write: 'created' },
      { harness: 'codex', path: '/h/.codex/config.toml', write: 'refused', detail: 'this file could not be read as toml: bad line 3' },
      {
        harness: 'cursor',
        path: '/r/.cursor/mcp.json',
        write: 'current',
        approved: 'refused',
        detail: 'cursor-agent exited 1: not logged in',
      },
    ];
    const installed = {
      skill: { target: '/r/.agents/skills/tagma', files: [] },
      links: ['/r/.claude/skills/tagma'],
      agents: { path: '/r/AGENTS.md', write: 'created' as const },
      instructions: [{ path: '/r/CLAUDE.md', write: 'absent' as const }],
      hooks: [],
      mcp,
    };
    for (const lines of [renderInstallResult(installed), renderUpgradeResult([{ place: 'repo', skill: '/r/.agents/skills/tagma', mcp }])]) {
      const said = lines.join('\n');
      expect(said).toContain('/r/.mcp.json');
      const at = lines.findIndex((line) => line.includes('/h/.codex/config.toml'));
      expect(at).toBeGreaterThan(-1);
      expect(lines[at + 1]).toContain('bad line 3');
      expect(said).toContain('approval refused');
      expect(said).toContain('not logged in');
    }
  });
});
