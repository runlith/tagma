import { parseCookieString, serializeCookie } from '../cookies.js';
import { Layer } from '../Layer.js';
import { Platform, type PlatformCookies, type PlatformStorage } from '../Platform.js';

function guarded(open: () => Storage): PlatformStorage {
  const area = (): Storage | null => {
    try {
      return open();
    } catch {
      return null;
    }
  };
  return {
    watch(key, listener) {
      const heard = (event: StorageEvent): void => {
        if (event.storageArea === null || event.storageArea !== area()) return;
        if (event.key === null || event.key === key) listener(event.key === null ? null : event.newValue);
      };
      window.addEventListener('storage', heard);
      return () => window.removeEventListener('storage', heard);
    },
    getItem(key) {
      try {
        return open().getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        open().setItem(key, value);
      } catch {}
    },
    removeItem(key) {
      try {
        open().removeItem(key);
      } catch {}
    },
    keys(prefix) {
      const store = area();
      if (store === null) return [];
      const found: string[] = [];
      for (let at = 0; at < store.length; at++) {
        const key = store.key(at);
        if (key !== null && key.startsWith(prefix)) found.push(key);
      }
      return found;
    },
  };
}

const documentCookies: PlatformCookies = {
  all() {
    try {
      return parseCookieString(document.cookie);
    } catch {
      return {};
    }
  },
  get(name) {
    return documentCookies.all()[name];
  },
  set(name, value, options = {}) {
    const isHttps = location.protocol === 'https:';
    if (options.secure && !isHttps)
      throw new Error(`Cookies: "${name}" asks for Secure, which needs https (this page is ${location.protocol}).`);
    document.cookie = serializeCookie(name, value, { ...options, secure: options.secure ?? isHttps });
  },
  delete(name, options = {}) {
    documentCookies.set(name, '', { ...options, maxAgeSeconds: 0, expires: new Date(0) });
  },
};

export function browserPlatform(): Platform {
  return new Platform({ local: guarded(() => localStorage), session: guarded(() => sessionStorage) }, documentCookies, {
    kind: 'browser',
    languages: navigator.languages,
    userAgent: navigator.userAgent,
  });
}

export const BrowserLive = Layer.provide(Platform, browserPlatform);
