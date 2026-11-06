import type { parse } from 'svelte/compiler';

type Node = { readonly type?: string; readonly [key: string]: unknown };

const nodes = (value: unknown, seen: Set<object> = new Set()): readonly Node[] => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return [];
  seen.add(value);
  const children = Array.isArray(value) ? value : Object.values(value);
  return [value as Node, ...children.flatMap((child) => nodes(child, seen))];
};

const frameNames = (script: unknown, module: string): ReadonlySet<string> =>
  new Set(
    nodes(script).flatMap((node) =>
      node.type === 'ImportDeclaration' && (node.source as { readonly value?: unknown } | undefined)?.value === module
        ? (
            node.specifiers as readonly {
              readonly type: string;
              readonly imported?: { readonly name?: string };
              readonly local: { readonly name: string };
            }[]
          )
            .filter((specifier) => specifier.type === 'ImportSpecifier' && specifier.imported?.name === 'Frame')
            .map((specifier) => specifier.local.name)
        : [],
    ),
  );

const asksMedia = (node: Node): boolean =>
  (node.attributes as readonly { readonly type: string; readonly name?: string; readonly value?: unknown }[] | undefined)?.some(
    (attribute) => attribute.type === 'Attribute' && attribute.name === 'media' && !isFalse(attribute.value),
  ) ?? false;

const isFalse = (value: unknown): boolean => {
  const [only, ...rest] = Array.isArray(value) ? value : [value];
  const expression = (only as { readonly expression?: { readonly type?: string; readonly value?: unknown } } | undefined)?.expression;
  return rest.length === 0 && expression?.type === 'Literal' && expression.value === false;
};

export const framesMedia = (parsed: typeof parse, source: string, module: string): boolean => {
  const root = parsed(source, { modern: true });
  const names = new Set([...frameNames(root.instance, module), ...frameNames(root.module, module)]);
  return (
    names.size > 0 && nodes(root.fragment).some((node) => node.type === 'Component' && names.has(String(node.name)) && asksMedia(node))
  );
};
