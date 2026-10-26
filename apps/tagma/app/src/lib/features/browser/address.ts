const SEARCH = 'https://www.google.com/search?q=';

const LOCAL = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#].*)?$/iu;

const DOMAIN = /^[^\s/:]+\.[a-z][a-z0-9-]+(:\d+)?([/?#].*)?$/iu;

export const addressOf = (typed: string): string | null => {
  const text = typed.trim();
  if (text === '') return null;
  if (/^(https?:\/\/|about:|blob:)/iu.test(text)) return text;
  if (/\s/u.test(text)) return `${SEARCH}${encodeURIComponent(text)}`;
  if (LOCAL.test(text)) return `http://${text}`;
  if (DOMAIN.test(text)) return `https://${text}`;
  return `${SEARCH}${encodeURIComponent(text)}`;
};
