import type { Resolver } from '@runlith/layer/key';
import type { Attachment } from 'svelte/attachments';
import type { Link } from './Link.js';
import { linkTarget } from './linkTarget.js';
import type { Opening } from './Opening.svelte.js';
import { type PathCheck, PathChecks } from './PathChecks.js';
import type { PathCode } from './pathCode.js';

export type PathLink = (code: PathCode) => Link;

export type PathRoad = PathCheck<PathLink | null>;

const codeOf = (element: HTMLElement): PathCode => {
  const line = element.dataset['line'];
  const column = element.dataset['column'];
  return {
    path: element.dataset['path'] ?? '',
    line: line === undefined ? null : Number(line),
    column: column === undefined ? null : Number(column),
  };
};

export class PathLinks {
  private readonly checks: PathChecks<PathLink | null> | undefined;

  constructor(
    private readonly opening: Opening,
    road: PathRoad | undefined,
    private readonly here?: Resolver,
  ) {
    this.checks = road === undefined ? undefined : new PathChecks(road);
  }

  close(): void {
    this.checks?.close();
  }

  attachment(hasPaths: boolean): Attachment<HTMLElement> {
    return (root) => {
      if (!hasPaths) return;
      let standing = true;
      const releases: (() => void)[] = [];
      for (const code of root.querySelectorAll<HTMLElement>('[data-path]')) {
        if (code.parentElement?.closest('[data-path], a')) continue;
        code.removeAttribute('role');
        code.removeAttribute('tabindex');
        code.removeAttribute('data-openable');
        const checks = this.checks;
        if (checks === undefined) continue;
        void checks.read(code.dataset['path'] ?? '').then(
          (link) => {
            if (!standing || checks.closed || link === null) return;
            code.setAttribute('role', 'link');
            code.setAttribute('tabindex', '0');
            code.setAttribute('data-openable', '');
            const release = linkTarget(this.opening, () => link(codeOf(code)), this.here)(code);
            if (typeof release === 'function') releases.push(release);
          },
          (cause) => {
            if (standing && !checks.closed) code.title = cause instanceof Error ? cause.message : String(cause);
          },
        );
      }
      return () => {
        standing = false;
        for (const release of releases.splice(0)) release();
      };
    };
  }
}
