type SectionAt = { readonly tagmaApp: string; readonly view: string };

export const sectionPath = (tagmaApp: string, view: string): string => `${tagmaApp}/${view}`;

export const sectionAt = (path: string): SectionAt | null => {
  const cut = path.indexOf('/');
  return cut > 0 && cut < path.length - 1 ? { tagmaApp: path.slice(0, cut), view: path.slice(cut + 1) } : null;
};
