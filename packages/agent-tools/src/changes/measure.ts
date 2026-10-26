export function gitMode(mode: number): string {
  return (mode & 0o111) === 0 ? '100644' : '100755';
}
