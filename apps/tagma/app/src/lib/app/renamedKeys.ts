const OLD = 'lode.';
const NEW = 'tagma.';

for (const storage of typeof window === 'undefined' ? [] : [window.localStorage, window.sessionStorage]) {
  const named = Array.from({ length: storage.length }, (_, at) => storage.key(at)).filter(
    (key): key is string => key?.startsWith(OLD) === true,
  );
  for (const key of named) {
    const value = storage.getItem(key);
    const renamed = `${NEW}${key.slice(OLD.length)}`;
    if (value !== null && storage.getItem(renamed) === null) storage.setItem(renamed, value);
    storage.removeItem(key);
  }
}
