type SectionAt = { readonly plugin: string; readonly view: string };

export const sectionPath = (plugin: string, view: string): string => `${plugin}/${view}`;

export const sectionAt = (path: string): SectionAt | null => {
  const cut = path.indexOf('/');
  return cut > 0 && cut < path.length - 1 ? { plugin: path.slice(0, cut), view: path.slice(cut + 1) } : null;
};
