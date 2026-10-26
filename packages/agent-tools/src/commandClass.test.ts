import { expect, test } from 'bun:test';
import { commandClass } from './commandClass';

test('the two check kinds are read off the command this repository runs them with', () => {
  expect(commandClass('bun test --parallel=6')).toBe('test');
  expect(commandClass('bun run --cwd packages/execution-host typecheck')).toBe('typecheck');
  expect(commandClass('bun run --cwd apps/tagma/server test')).toBe('test');
  expect(commandClass('npm run typecheck')).toBe('typecheck');
});

test('a tool that is its own kind is read wherever it stands, and a path is not a tool', () => {
  expect(commandClass('tsc -b tsconfig.json')).toBe('typecheck');
  expect(commandClass('/usr/local/bin/svelte-check --threshold error')).toBe('typecheck');
  expect(commandClass('bunx vitest run')).toBe('test');
  expect(commandClass('bun run --cwd packages/git test')).toBe('test');
});

test('git is its own class, and a leading environment assignment is not the program', () => {
  expect(commandClass('git status --porcelain -z')).toBe('git');
  expect(commandClass('GIT_PAGER=cat git log --oneline -10')).toBe('git');
});

test('everything a rule cannot decide is other, and never a class nothing can answer', () => {
  expect(commandClass('bun run build')).toBe('other');
  expect(commandClass('ls -la')).toBe('other');
  expect(commandClass('')).toBe('other');
  expect(commandClass('cd packages/checks && bun test')).toBe('other');
});
