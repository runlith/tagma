import { expect, test } from 'bun:test';
import { commandLineOf } from './commands.js';

test('a shell script launch IS its script, and nothing else is unwrapped by a -c argument', () => {
  expect(commandLineOf('/bin/sh', ['-c', 'bun run typecheck'])).toBe('bun run typecheck');
  expect(commandLineOf('/opt/homebrew/bin/zsh', ['-c', 'ls -la | head'])).toBe('ls -la | head');
  expect(commandLineOf('/usr/bin/grep', ['-c', 'needle', 'file.txt'])).toBe('/usr/bin/grep -c needle file.txt');
  expect(commandLineOf('/bin/bash', [])).toBe('/bin/bash');
});

test('anything else is the program with its arguments, quoted only where a shell would need it', () => {
  expect(commandLineOf('git', ['status', '--porcelain=v2'])).toBe('git status --porcelain=v2');
  expect(commandLineOf('git', ['commit', '-m', 'two words'])).toBe(`git commit -m 'two words'`);
  expect(commandLineOf('say', [`it's here`])).toBe(`say 'it'\\''s here'`);
});
