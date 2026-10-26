import { toldOf } from '$lib/wire/refusal.js';
import type { LocalFilesPort } from './LocalFiles.js';

export type DroppedPaths = { readonly paths: readonly string[]; readonly problems: readonly string[] };

export type FileDrop = (files: readonly File[]) => Promise<DroppedPaths>;

export function fileDrop(local: LocalFilesPort | undefined, keep: (file: File) => Promise<string>): FileDrop {
  return async (files) => {
    const paths: string[] = [];
    const problems: string[] = [];
    for (const file of files) {
      try {
        const own = local?.pathOf(file) ?? '';
        paths.push(own === '' ? await keep(file) : own);
      } catch (error) {
        problems.push(`${file.name}: ${toldOf(error).text}`);
      }
    }
    return { paths, problems };
  };
}
