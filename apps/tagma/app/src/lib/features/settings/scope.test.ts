import { expect, test } from 'vitest';
import { sectionScope, sectionScopes } from './scope.js';

test('a section opens on the layer its keys accept, whatever layer the address asks for', () => {
  const machine = [{ scopes: ['user'] as const }, { scopes: ['user'] as const }];
  const both = [{ scopes: ['user'] as const }, { scopes: ['user', 'project'] as const }];

  expect(sectionScopes(machine)).toEqual(['user']);
  expect(sectionScope(machine, 'project')).toBe('user');
  expect(sectionScopes(both)).toEqual(['user', 'project']);
  expect(sectionScope(both, 'project')).toBe('project');
  expect(sectionScope([], 'project')).toBe('project');
});
