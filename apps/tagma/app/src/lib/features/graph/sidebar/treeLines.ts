export type TreeLine = {
  readonly name: string;
  readonly depth: number;
  readonly parent: string;
  readonly count: number;
};

export type TreeStep =
  | { readonly kind: 'focus'; readonly name: string }
  | { readonly kind: 'expand'; readonly name: string }
  | { readonly kind: 'collapse'; readonly name: string };

export function treeLines(root: string, children: (name: string) => readonly string[], expanded: ReadonlySet<string>): TreeLine[] {
  const lines: TreeLine[] = [];
  const walk = (parent: string, depth: number): void => {
    for (const name of children(parent)) {
      const count = children(name).length;
      lines.push({ name, depth, parent, count });
      if (count > 0 && expanded.has(name)) walk(name, depth + 1);
    }
  };
  walk(root, 1);
  return lines;
}

export function treeStep(lines: readonly TreeLine[], at: string | null, key: string, expanded: ReadonlySet<string>): TreeStep | null {
  const index = lines.findIndex((line) => line.name === at);
  const line = lines[index];
  if (line === undefined) return focusAt(lines, 0);
  switch (key) {
    case 'ArrowDown':
      return focusAt(lines, index + 1);
    case 'ArrowUp':
      return focusAt(lines, index - 1);
    case 'Home':
      return focusAt(lines, 0);
    case 'End':
      return focusAt(lines, lines.length - 1);
    case 'ArrowRight':
      if (line.count === 0) return null;
      return expanded.has(line.name) ? focusAt(lines, index + 1) : { kind: 'expand', name: line.name };
    case 'ArrowLeft':
      if (line.count > 0 && expanded.has(line.name)) return { kind: 'collapse', name: line.name };
      return lines.some((other) => other.name === line.parent) ? { kind: 'focus', name: line.parent } : null;
    default:
      return null;
  }
}

function focusAt(lines: readonly TreeLine[], index: number): TreeStep | null {
  const line = lines[index];
  return line === undefined ? null : { kind: 'focus', name: line.name };
}
