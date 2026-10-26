import { expect, test } from 'bun:test';
import { shellCommands, type ShellCommand } from './shellCommands';

function read(text: string): readonly ShellCommand[] {
  const commands = shellCommands(text);
  expect(commands).not.toBeNull();
  return commands as readonly ShellCommand[];
}

test('a chain carrying a heredoc still splits, and the body belongs to the command that opened it', () => {
  const [first, second] = read('mkdir -p src && cat > src/a.ts <<EOF\nexport const a = 1;\nEOF');
  expect(first?.words.map((word) => word.text)).toEqual(['mkdir', '-p', 'src']);
  expect(second?.words.map((word) => word.text)).toEqual(['cat']);
  expect(second?.redirects[0]?.target).toEqual({ text: 'src/a.ts', literal: true });
  expect(second?.heredocs[0]?.body).toBe('export const a = 1;\n');
});

test('the redirect may stand after the delimiter and reads the same', () => {
  const [only] = read('cat <<EOF > src/a.ts\nbody\nEOF');
  expect(only?.redirects[0]?.target).toEqual({ text: 'src/a.ts', literal: true });
  expect(only?.heredocs[0]?.body).toBe('body\n');
});

test('an && inside a heredoc body is text, not an operator', () => {
  const commands = read('cat <<EOF > out\na && b\nEOF');
  expect(commands).toHaveLength(1);
  expect(commands[0]?.heredocs[0]?.body).toBe('a && b\n');
});

test('a quoted delimiter says the body is not expanded', () => {
  expect(read("cat <<'EOF' > out\nx\nEOF")[0]?.heredocs[0]?.expand).toBe(false);
  expect(read('cat <<EOF > out\nx\nEOF')[0]?.heredocs[0]?.expand).toBe(true);
});

test('a > inside quotes is a character of a word, and so is an escaped one', () => {
  const quoted = read("echo 'hello > notes.txt'");
  expect(quoted[0]?.redirects).toHaveLength(0);
  expect(quoted[0]?.words.map((word) => word.text)).toEqual(['echo', 'hello > notes.txt']);
  const escaped = read('echo hello \\> notes.txt');
  expect(escaped[0]?.redirects).toHaveLength(0);
  expect(escaped[0]?.words.map((word) => word.text)).toEqual(['echo', 'hello', '>', 'notes.txt']);
});

test('a descriptor redirect names no file, and a numbered one keeps its descriptor', () => {
  const [only] = read('echo hi > out.txt 2>&1');
  expect(only?.redirects.map((redirect) => redirect.fd)).toEqual([1, 2]);
  expect(only?.redirects[1]?.target).toBe('descriptor');
  expect(read('echo hi 2> log')[0]?.redirects[0]?.fd).toBe(2);
});

test('a substitution is opaque: its operators are its own, and the word is not literal', () => {
  const commands = read('echo "$(git log && echo x)" > version.txt');
  expect(commands).toHaveLength(1);
  expect(commands[0]?.words[1]?.literal).toBe(false);
  expect(commands[0]?.redirects[0]?.target).toEqual({ text: 'version.txt', literal: true });
});

test('a comment ends the line, and a # inside a word does not start one', () => {
  const [only] = read('echo hello > notes.txt # write the note');
  expect(only?.redirects[0]?.target).toEqual({ text: 'notes.txt', literal: true });
  expect(read('echo a#b')[0]?.words.map((word) => word.text)).toEqual(['echo', 'a#b']);
});

test('a pipe says the next command reads somebody else output', () => {
  const [first, second] = read('bun test | tee log.txt');
  expect(first?.piped).toBe(false);
  expect(second?.piped).toBe(true);
});

test('a leading assignment is the environment, not the verb', () => {
  const [only] = read('FOO=1 echo hi');
  expect(only?.assignments.map((word) => word.text)).toEqual(['FOO=1']);
  expect(only?.words.map((word) => word.text)).toEqual(['echo', 'hi']);
});

test('a glob, a variable and a tilde are words the shell resolves, and say so', () => {
  const [only] = read('sed -i s/a/b/ *.ts $FILE ~/x');
  expect(only?.words.slice(3).map((word) => word.literal)).toEqual([false, false, false]);
});

test('a compound construct, a subshell and an unterminated quote are unreadable', () => {
  expect(shellCommands('for f in *.ts; do sed -i s/a/b/ $f; done')).toBeNull();
  expect(shellCommands('if true; then echo hi > f; fi')).toBeNull();
  expect(shellCommands('(cd src && echo hi > a.txt)')).toBeNull();
  expect(shellCommands("echo 'unterminated > f")).toBeNull();
});
