export type CodePart = { readonly code: boolean; readonly text: string };

export const codeParts = (text: string): readonly CodePart[] => {
  const parts: CodePart[] = [];
  let rest = text;
  while (rest.length > 0) {
    const open = rest.indexOf('`');
    const close = open === -1 ? -1 : rest.indexOf('`', open + 1);
    if (close === -1 || close === open + 1) {
      parts.push({ code: false, text: rest });
      break;
    }
    if (open > 0) parts.push({ code: false, text: rest.slice(0, open) });
    parts.push({ code: true, text: rest.slice(open + 1, close) });
    rest = rest.slice(close + 1);
  }
  return parts;
};
