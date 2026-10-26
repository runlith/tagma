/// <reference types="bun" />

import { connect, createServer, isIP, type Socket } from 'node:net';
import { lookup } from 'node:dns';

type Grant = {
  readonly port: number;
  readonly hosts: readonly string[];
};

const HEADER_CEILING = 8 * 1024;
const HEADER_DEADLINE_MS = 10_000;
const CONNECT_DEADLINE_MS = 20_000;
const IDLE_DEADLINE_MS = 120_000;
const OPEN_CEILING = 64;

const grant: Grant = JSON.parse(process.argv[2] ?? '{}') as Grant;
const admitted = new Set((grant.hosts ?? []).map((host) => host.toLowerCase()));
let open = 0;

const decided = (verdict: string, host: string, why: string): void => {
  process.stdout.write(`${verdict} ${host} ${why}\n`);
};

const refuse = (client: Socket, status: string, host: string, why: string): void => {
  decided('refused', host, why);
  client.end(`HTTP/1.1 ${status}\r\nconnection: close\r\n\r\n`);
};

const publicAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return publicV4(address);
  if (family === 6) return publicV6(address);
  return false;
};

const publicV4 = (address: string): boolean => {
  const octets = address.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a = 0, b = 0] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a >= 224) return false;
  return true;
};

const publicV6 = (address: string): boolean => {
  const bytes = bytesOfV6(address);
  if (bytes === null) return false;
  const zeroes = (upTo: number): boolean => bytes.slice(0, upTo).every((byte) => byte === 0);
  if (zeroes(10) && bytes[10] === 0xff && bytes[11] === 0xff) return publicV4(quad(bytes, 12));
  if (zeroes(12)) return false;
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((byte) => byte === 0)) {
    return publicV4(quad(bytes, 12));
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return publicV4(quad(bytes, 2));
  if ((bytes[0] ?? 0) === 0xff) return false;
  if (((bytes[0] ?? 0) & 0xfe) === 0xfc) return false;
  if ((bytes[0] ?? 0) === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) return false;
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && bytes.slice(2, 8).every((byte) => byte === 0)) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false;
  return true;
};

const quad = (bytes: Uint8Array, at: number): string =>
  [bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0].join('.');

const bytesOfV6 = (address: string): Uint8Array | null => {
  const said = address.toLowerCase().split('%')[0] ?? '';
  const [head = '', tail, extra] = said.split('::');
  if (extra !== undefined) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    const pieces = part.split(':');
    for (let at = 0; at < pieces.length; at += 1) {
      const piece = pieces[at] as string;
      if (at === pieces.length - 1 && piece.includes('.')) {
        const octets = piece.split('.').map((octet) => Number(octet));
        if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
          return null;
        }
        groups.push(((octets[0] as number) << 8) | (octets[1] as number));
        groups.push(((octets[2] as number) << 8) | (octets[3] as number));
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      groups.push(Number.parseInt(piece, 16));
    }
    return groups;
  };
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  if (left === null || right === null) return null;
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? missing !== 0 : missing < 0) return null;
  const groups = [...left, ...new Array<number>(tail === undefined ? 0 : missing).fill(0), ...right];
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, at) => {
    bytes[at * 2] = (group >> 8) & 0xff;
    bytes[at * 2 + 1] = group & 0xff;
  });
  return bytes;
};

const server = createServer((client) => {
  if (open >= OPEN_CEILING) {
    refuse(client, '429 Too Many Requests', '-', 'this build already holds every connection it may');
    return;
  }
  open += 1;
  client.once('close', () => {
    open -= 1;
  });
  client.on('error', () => client.destroy());

  let header = '';
  let reading = true;
  client.setTimeout(HEADER_DEADLINE_MS, () => {
    if (reading) refuse(client, '408 Request Timeout', '-', 'no request arrived');
  });
  client.on('data', (chunk: Buffer) => {
    if (!reading) return;
    header += chunk.toString('latin1');
    if (header.length > HEADER_CEILING) {
      reading = false;
      refuse(client, '431 Request Header Fields Too Large', '-', 'the request head is past the ceiling');
      return;
    }
    const end = header.indexOf('\r\n\r\n');
    if (end < 0) return;
    reading = false;
    client.setTimeout(0);
    admit(client, header.slice(0, end));
  });
});

const admit = (client: Socket, head: string): void => {
  const [line = ''] = head.split('\r\n');
  const [method = '', target = ''] = line.split(' ');
  if (method.toUpperCase() !== 'CONNECT') {
    refuse(client, '405 Method Not Allowed', target || '-', `${method || 'nothing'} is not a method this proxy serves`);
    return;
  }
  const cut = target.lastIndexOf(':');
  const host = (cut > 0 ? target.slice(0, cut) : target).replace(/^\[|\]$/g, '').toLowerCase();
  const port = cut > 0 ? Number(target.slice(cut + 1)) : 0;
  if (!admitted.has(host)) {
    refuse(client, '403 Forbidden', host || '-', 'it is not a destination this build was granted');
    return;
  }
  if (port !== 443) {
    refuse(client, '403 Forbidden', host, `port ${port} is not the one port this proxy serves`);
    return;
  }
  lookup(host, { all: true, verbatim: true }, (failure, addresses) => {
    if (failure || addresses.length === 0) {
      refuse(client, '502 Bad Gateway', host, `it does not resolve: ${failure?.message ?? 'no address'}`);
      return;
    }
    const routable = addresses.map((answer) => answer.address).filter(publicAddress);
    if (routable.length === 0) {
      refuse(client, '403 Forbidden', host, `it resolves only to addresses off the public internet`);
      return;
    }
    tunnel(client, host, routable[0] as string);
  });
};

const tunnel = (client: Socket, host: string, address: string): void => {
  const upstream = connect({ host: address, port: 443, family: isIP(address) });
  upstream.setTimeout(CONNECT_DEADLINE_MS, () => upstream.destroy(new Error('the destination did not answer')));
  upstream.on('error', (cause: Error) => {
    if (!client.destroyed) refuse(client, '502 Bad Gateway', host, cause.message);
    upstream.destroy();
  });
  upstream.on('connect', () => {
    decided('admitted', host, address);
    upstream.setTimeout(IDLE_DEADLINE_MS, () => upstream.destroy());
    client.setTimeout(IDLE_DEADLINE_MS, () => client.destroy());
    client.write('HTTP/1.1 200 Connection established\r\n\r\n');
    client.pipe(upstream);
    upstream.pipe(client);
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
  });
};

server.on('error', (cause: Error) => {
  process.stderr.write(`the proxy could not listen: ${cause.message}\n`);
  process.exit(1);
});

server.listen(grant.port, '0.0.0.0', () => {
  decided('listening', `0.0.0.0:${grant.port}`, `${[...admitted].join(' ') || 'nothing'}`);
});
