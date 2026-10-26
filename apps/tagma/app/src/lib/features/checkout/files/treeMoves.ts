export type MenuAim = {
  readonly x: number;
  readonly y: number;
  readonly path: string;
  readonly directory: boolean;
  readonly paths: readonly string[];
};

export type Move = { readonly from: string; readonly to: string };

const parentOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export function dropMoves(dragged: readonly string[], dir: string): readonly Move[] {
  const outermost = dragged.filter((path) => !dragged.some((other) => other !== path && path.startsWith(`${other}/`)));
  return outermost
    .filter((path) => parentOf(path) !== dir && dir !== path && !dir.startsWith(`${path}/`))
    .map((path) => ({ from: path, to: dir === '' ? nameOf(path) : `${dir}/${nameOf(path)}` }));
}
