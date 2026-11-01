import { Effect } from 'effect';
import { resultPage } from '../platform/http/resultPage.js';
import type { RouteHandler } from '../platform/contract/service/route.js';
import type { McpServers } from './contract/service/servers.js';

export const callbackHandler =
  (servers: McpServers['Service']): RouteHandler =>
  ({ request }) => {
    const query = new URL(request.url, 'http://localhost').searchParams;
    return servers
      .finishSignIn({
        state: query.get('state'),
        code: query.get('code'),
        iss: query.get('iss'),
        error: query.get('error'),
        description: query.get('error_description'),
      })
      .pipe(
        Effect.match({
          onSuccess: ({ server, connected }) =>
            resultPage(
              `Signed in to ${server}`,
              connected === null
                ? 'Tagma keeps the sign-in; the server connects when a project uses it. You can close this tab.'
                : connected
                  ? 'Tagma keeps the sign-in and has connected the server. You can close this tab.'
                  : 'Tagma keeps the sign-in, but the server did not connect; its card in Tagma says why.',
              200,
            ),
          onFailure: (refused) =>
            resultPage(refused.server === undefined ? 'Sign-in refused' : `Sign-in to ${refused.server} refused`, refused.reason, 400),
        }),
      );
  };
