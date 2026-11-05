import { type OperationId, type TagmaClient, TagmaRefused } from './plugin.js';

type TagmaPlace = { readonly server: string | null; readonly caller: string };

const bodyOf = async (response: Response): Promise<Readonly<Record<string, unknown>> | null> => {
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Readonly<Record<string, unknown>>) : null;
  } catch {
    return null;
  }
};

const call = async (place: TagmaPlace, project: number | null, id: OperationId, input: unknown): Promise<never> => {
  if (place.server === null) throw new Error(`${id} cannot be called: this process was started without TAGMA_SERVER_URL`);
  const query = project === null ? '' : `?project=${project}`;
  const response = await fetch(`${place.server.replace(/\/+$/u, '')}/api/op/${id}${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tagma-caller': place.caller },
    body: JSON.stringify(input),
  });
  const body = await bodyOf(response);
  if (response.ok && body !== null) return body as never;
  if (body !== null && response.status !== 500 && typeof body.code === 'string' && typeof body.reason === 'string')
    throw new TagmaRefused(id, body.code, body.reason, Array.isArray(body.unblock) ? body.unblock.map(String) : []);
  throw new Error(`${id} failed with HTTP ${response.status}${body === null ? '' : `: ${JSON.stringify(body)}`}`);
};

export const tagmaClient = (place: TagmaPlace, project: number | null): TagmaClient => ({
  op: (id, input) => call(place, project, id, input),
  in: (other) => tagmaClient(place, other),
});
