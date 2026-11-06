export const GENERATED_ATTRIBUTE = 'linguist-generated';

export const markedGenerated = (value: string | undefined): boolean => value === 'set' || value === 'true';

export const generatedQuestion = (paths: readonly string[], source: string | null) => ({
  args: ['check-attr', '-z', '--stdin', ...(source === null ? [] : ['--source', source]), GENERATED_ATTRIBUTE],
  stdin: paths.map((path) => `${path}\0`).join(''),
});

export const generatedAnswer = (answer: string): ReadonlySet<string> => {
  const generated = new Set<string>();
  const fields = answer.split('\0');
  for (let at = 0; at + 2 < fields.length; at += 3) if (markedGenerated(fields[at + 2])) generated.add(fields[at] as string);
  return generated;
};
