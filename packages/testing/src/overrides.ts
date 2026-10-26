export function withOverrides<T extends object>(base: T, overrides?: object): T {
  if (!overrides) return base;
  return Object.defineProperties(base, Object.getOwnPropertyDescriptors(overrides));
}
