import { escapeHtml } from '@runlith/utils/text';
import { HttpServerResponse } from 'effect/http';

export const resultPage = (title: string, said: string, status: number) =>
  HttpServerResponse.text(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><body style="font:15px system-ui;padding:2rem;max-width:36rem"><h1 style="font-size:18px">${escapeHtml(title)}</h1><p>${escapeHtml(said)}</p>`,
    { status, contentType: 'text/html; charset=utf-8' },
  ).pipe(
    HttpServerResponse.setHeaders({
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'referrer-policy': 'no-referrer',
    }),
  );
