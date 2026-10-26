export type Header = {
  readonly id: number | undefined;
  readonly method: string | undefined;
  readonly sessionId: string | undefined;
  readonly error: boolean;
};

const HEAD = 160;
const TAIL = 96;

const REPLY = /^\{"id":(\d+),"(result|error)"/;
const EVENT = /^\{"method":"([^"\\]{1,120})"/;
const SESSION = /\},"sessionId":"([^"\\]{1,64})"\}$/;

export function header(text: string): Header {
  const head = text.length > HEAD ? text.slice(0, HEAD) : text;
  const tail = text.length > TAIL ? text.slice(-TAIL) : text;
  const session = SESSION.exec(tail)?.[1];
  const reply = REPLY.exec(head);
  if (reply !== null) return { id: Number(reply[1]), method: undefined, sessionId: session, error: reply[2] === 'error' };
  return { id: undefined, method: EVENT.exec(head)?.[1], sessionId: session, error: false };
}

export const commandText = (id: number, method: string, params: object | undefined, sessionId: string | undefined): string =>
  sessionId === undefined
    ? JSON.stringify({ id, method, params: params ?? {} })
    : JSON.stringify({ id, method, params: params ?? {}, sessionId });
