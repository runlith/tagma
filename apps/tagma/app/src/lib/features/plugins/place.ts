export const PLUGINS = 'plugins';

export type Place =
  | { readonly kind: 'catalog' }
  | { readonly kind: 'find'; readonly query: string }
  | { readonly kind: 'category'; readonly name: string }
  | { readonly kind: 'source'; readonly id: string }
  | { readonly kind: 'entry'; readonly marketplace: string; readonly name: string }
  | { readonly kind: 'plugin'; readonly id: string }
  | { readonly kind: 'server'; readonly scope: string; readonly name: string };

const CUT = '~';

const split = (rest: string): readonly [string, string] | null => {
  const at = rest.indexOf(CUT);
  return at <= 0 || at === rest.length - 1 ? null : [rest.slice(0, at), rest.slice(at + 1)];
};

export function placeOf(id: string | null): Place {
  if (id === null || id === '') return { kind: 'catalog' };
  const head = split(id);
  if (head === null) return { kind: 'catalog' };
  const [kind, rest] = head;
  if (kind === 'find') return { kind, query: rest };
  if (kind === 'category') return { kind, name: rest };
  if (kind === 'source') return { kind, id: rest };
  if (kind === 'plugin') return { kind, id: rest };
  const pair = split(rest);
  if (pair === null) return { kind: 'catalog' };
  if (kind === 'entry') return { kind, marketplace: pair[0], name: pair[1] };
  if (kind === 'server') return { kind, scope: pair[0], name: pair[1] };
  return { kind: 'catalog' };
}

export function idOf(place: Place): string | null {
  switch (place.kind) {
    case 'catalog':
      return null;
    case 'find':
      return `find${CUT}${place.query}`;
    case 'category':
      return `category${CUT}${place.name}`;
    case 'source':
      return `source${CUT}${place.id}`;
    case 'plugin':
      return `plugin${CUT}${place.id}`;
    case 'entry':
      return `entry${CUT}${place.marketplace}${CUT}${place.name}`;
    case 'server':
      return `server${CUT}${place.scope}${CUT}${place.name}`;
  }
}

export const samePlace = (left: Place, right: Place): boolean => idOf(left) === idOf(right);
