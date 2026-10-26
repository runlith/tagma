const PROJECT_MENTION = 'project:';
const PROJECT_REF_SOURCE = String.raw`\[\[project:([1-9][0-9]*)(?:\|([^\]\n]+))?\]\]`;
export const PROJECT_REF = new RegExp(PROJECT_REF_SOURCE, 'g');
export const PROJECT_REF_INLINE = new RegExp(`^${PROJECT_REF_SOURCE}`);

export function projectMention(projectId: number): string {
  return `${PROJECT_MENTION}${projectId}`;
}

export function mentionedProject(name: string): number | null {
  if (!name.startsWith(PROJECT_MENTION)) return null;
  const id = name.slice(PROJECT_MENTION.length);
  return /^[1-9][0-9]*$/u.test(id) ? Number(id) : null;
}
