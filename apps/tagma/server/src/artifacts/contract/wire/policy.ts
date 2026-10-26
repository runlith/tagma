export const PAGE_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://cdn.tailwindcss.com https://code.jquery.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com data:',
  'img-src data: blob:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

export const PAGE_SANDBOX_FLAGS = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

export const PAGE_SANDBOX = `sandbox ${PAGE_SANDBOX_FLAGS}`;

export const pagePolicy = (sandboxed: boolean): string => (sandboxed ? `${PAGE_POLICY}; ${PAGE_SANDBOX}` : PAGE_POLICY);
