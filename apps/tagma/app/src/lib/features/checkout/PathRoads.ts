import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { Service } from '@runlith/layer/key';
import type { LinkFrom } from '$lib/features/opening/Link.js';
import type { PathRoad } from '$lib/features/opening/PathLinks.js';
import { FileOpener, type Picture } from './files/FileOpener.svelte.js';
import { Outside } from './files/Outside.svelte.js';
import { directoryLink, fileLink } from './links.js';

export type PathBase = {
  readonly root?: RootId | undefined;
  readonly picture?: ((picture: Picture) => void) | undefined;
};

export class PathRoads extends Service<PathRoads>()('PathRoads', { tier: 'app' }) {
  static *make() {
    return new PathRoads(yield* FileOpener, yield* Outside);
  }

  constructor(
    private readonly opener: FileOpener,
    private readonly outside: Outside,
  ) {
    super();
  }

  road(from: LinkFrom, base: PathBase = {}): PathRoad {
    return async (path, signal) => {
      const { entry, place } = await this.opener.resolve(path, from.folder, signal, from.project, base.root, from.thread);
      if (entry === null) return null;
      if (entry.kind === 'file') {
        return (code) => fileLink({ path: code.path, line: code.line, column: code.column, root: base.root, picture: base.picture }, from);
      }
      if (place === null && !this.outside.local) return null;
      const link = directoryLink({ absolute: entry.path, place }, from);
      return () => link;
    };
  }
}
