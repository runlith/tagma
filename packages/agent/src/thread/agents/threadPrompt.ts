export function threadPrompt(instructions: string, overlay: string | undefined, sources: readonly string[]): string {
  const addition = overlay?.trim();
  return [addition ? `${instructions}\n\n${addition}` : instructions, ...sources].join('\n\n');
}
