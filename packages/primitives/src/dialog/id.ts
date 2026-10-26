let seq = 0;

export function createDialogId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}
