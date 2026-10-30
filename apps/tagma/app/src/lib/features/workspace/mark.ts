import type { Project } from '@tagma/server/graph/contract/wire/rows';

const HUES = [
  'var(--project-1)',
  'var(--project-2)',
  'var(--project-3)',
  'var(--project-4)',
  'var(--project-5)',
  'var(--project-6)',
  'var(--project-7)',
  'var(--project-8)',
] as const;

export const hueOf = (projectId: number): string => HUES[Math.abs(projectId) % HUES.length] as string;

export const labelOf = (project: Project): string => (project.kind === 'global' ? 'Shared graph' : project.name);

export function initialsOf(name: string): string {
  const [first, second] = name.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '');
  if (first === undefined) return name.slice(0, 2);
  if (second !== undefined) return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
  return `${first.charAt(0).toUpperCase()}${first.charAt(1).toLowerCase()}`;
}
