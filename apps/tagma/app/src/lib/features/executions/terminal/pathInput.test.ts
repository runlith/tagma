import { expect, test } from 'vitest';
import { paneShell, pathInput, shellEscapePath } from './pathInput.js';

test('fish reads escapes inside single quotes, so a path escaped for it doubles its backslashes', () => {
  expect(shellEscapePath('/tmp/a b\\', 'fish')).toBe(`'/tmp/a b\\\\'`);
  expect(shellEscapePath('/tmp/a b\\', 'posix')).toBe(`'/tmp/a b\\'`);
  expect(paneShell('/opt/homebrew/bin/fish')).toBe('fish');
  expect(paneShell('/bin/zsh')).toBe('posix');
});

test('a picture path is never quoted, since a TUI attaches it only when it reads as the bare path', () => {
  const posix = pathInput(['/Users/ana/Снимок 10.04 PM.png', '/tmp/shot.PNG', "/tmp/it's (1).jpg", '/tmp/deck.pdf'], 'posix');
  expect(posix.pieces).toEqual(['/Users/ana/Снимок\\ 10.04 PM.png', '/tmp/shot.PNG', "/tmp/it\\'s\\ \\(1\\).jpg", '/tmp/deck.pdf']);
  expect(pathInput(['/tmp/a~b!.png'], 'fish').pieces).toEqual(['/tmp/a\\~b!.png']);
});

test('a path holding a control character is left out and counted, the rest still typed', () => {
  expect(pathInput(['/tmp/a\nb.png', '/tmp/ok.txt'], 'posix')).toEqual({ pieces: ['/tmp/ok.txt'], refused: 1 });
});
