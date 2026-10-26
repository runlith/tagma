import { matchesGlob } from 'node:path';
import type { BindingReach } from '@tagma/inspection/program';

export const inProgramReach = (reach: BindingReach, path: string): boolean =>
  reach.places.some((place) => place === '' || path === place || path.startsWith(`${place}/`)) &&
  (reach.files === undefined || reach.files.some((glob) => matchesGlob(path, glob)));
