import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { mcpCallTool } from '@runlith/mcp/testing/sdk';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { PAGE_OPERATIONS } from '../../../browser/contract/wire/pageOperations.js';
import { Hosts } from '../../../browser/contract/service/hosts.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { MCP_KEY_VARIABLE } from '../../../platform/contract/wire/session.js';
import { MEDIA_HEADER, MEDIA_INLINE } from '../../../invocation/contract/wire/headers.js';
import { PROFILE_OPERATIONS } from '../../../browser/contract/wire/profileOperations.js';
import { MANAGED } from '../../../managed-browser/contract/wire/document.js';
import { managedTestHost } from '../../../managed-browser/testing/host.js';
import { makeMcpWorld } from './mcpRig.js';

const setup = Effect.gen(function* () {
  const rig = yield* makeMcpWorld();
  const home = yield* rig.world.directory('media-browser');
  const hosts = Context.getOrUndefined(rig.world.runtime.owners, Hosts)!;
  yield* Layer.build(managedTestHost(home).pipe(Layer.provide(Layer.succeed(Hosts, hosts))));
  const bridge = yield* rig.bridge('codex', { [MCP_KEY_VARIABLE]: 'itest-screenshot-media' });
  return { ...rig, bridge, files: yield* FileSystem.FileSystem };
});
class Media extends Context.Service<Media, Effect.Success<typeof setup>>()('testing/ScreenshotMedia') {}

const request = Effect.fnUntraced(function* (operation: string, input: unknown, headers: Record<string, string> = {}) {
  const { world, project } = yield* Media;
  const response = yield* Effect.promise((signal) =>
    fetch(`${world.url}/api/op/${operation}?project=${project.id}`, {
      signal,
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(input),
    }),
  );
  const body: unknown = yield* Effect.promise(() => response.json());
  expect({ status: response.status, body }).toMatchObject({ status: 200 });
  return body;
});
const captured = Schema.decodeUnknownEffect(knownAnswer(PAGE_OPERATIONS.capture_page.answer));
const media = Schema.Struct({ mimeType: Schema.Literal('image/png'), data: Schema.String });
const metadata = Schema.decodeUnknownEffect(Schema.Struct({ _meta: Schema.optional(Schema.Struct({ media: Schema.Array(media) })) }));
const mcpResult = Schema.decodeUnknownEffect(
  Schema.Struct({
    isError: Schema.optional(Schema.Boolean),
    content: Schema.Array(
      Schema.Union([
        Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
        Schema.Struct({ type: Schema.Literal('image'), ...media.fields }),
      ]),
    ),
    structuredContent: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
);
const png = (bytes: Uint8Array) => {
  const buffer = Buffer.from(bytes);
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(buffer.toString('ascii', 12, 16)).toBe('IHDR');
  expect([buffer.readUInt32BE(16), buffer.readUInt32BE(20)]).toEqual([640, 480]);
};

layer(Layer.effect(Media, setup.pipe(Effect.provide(BunFileSystem.layer))), { excludeTestServices: true })(
  'screenshot media doors',
  (it) => {
    it.effect('HTTP opts into a viewport PNG and the MCP bridge delivers it once as image content', () =>
      Effect.gen(function* () {
        const { bridge, call, files } = yield* Media;
        const listed = yield* Schema.decodeUnknownEffect(knownAnswer(PROFILE_OPERATIONS.list_profiles.answer))(
          yield* request('list_profiles', {}),
        );
        const profile = listed.profiles.find((profile) => profile.adapter === MANAGED && profile.connected);
        expect(profile).toBeDefined();
        const opened = yield* Schema.decodeUnknownEffect(knownAnswer(PAGE_OPERATIONS.open_page.answer))(
          yield* request('open_page', { profile: profile!.id, url: 'about:blank' }),
        );
        const page = opened.page.id;
        yield* Effect.addFinalizer(() => request('close_page', { page }));
        expect(yield* request('emulate_page', { page, viewport: { width: 640, height: 480, scale: 1 } })).toMatchObject({
          status: 'emulated',
        });

        const fileOnly = yield* request('capture_page', { page });
        const saved = yield* captured(fileOnly);
        expect(saved).toMatchObject({ status: 'captured', mediaType: 'image/png', width: 640, height: 480 });
        png(yield* files.readFile(saved.path));
        expect((yield* metadata(fileOnly))._meta).toBeUndefined();

        const inline = yield* request('capture_page', { page }, { [MEDIA_HEADER]: MEDIA_INLINE });
        const image = (yield* metadata(inline))._meta?.media;
        expect(image).toHaveLength(1);
        const bytes = Buffer.from(image![0]!.data, 'base64');
        png(bytes);
        const inlineFile = yield* captured(inline);
        expect(bytes.byteLength).toBe(inlineFile.bytes);
        expect(bytes).toEqual(Buffer.from(yield* files.readFile(inlineFile.path)));

        for (const json of [false, true]) {
          const answer = yield* mcpResult(yield* mcpCallTool(bridge, 'capture_page', { page, json }, call));
          expect(answer.isError).not.toBe(true);
          const images = answer.content.filter((part) => part.type === 'image');
          expect(images).toHaveLength(1);
          const picture = images[0]!;
          png(Buffer.from(picture.data, 'base64'));
          const text = answer.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n');
          expect(text).not.toContain(picture.data);
          expect(JSON.stringify(answer.structuredContent) ?? '').not.toContain(picture.data);
          if (json) {
            const document = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(knownAnswer(PAGE_OPERATIONS.capture_page.answer)))(
              text,
            );
            expect(document).toMatchObject({ status: 'captured', mediaType: 'image/png', width: 640, height: 480 });
            expect(Buffer.from(picture.data, 'base64')).toEqual(Buffer.from(yield* files.readFile(document.path)));
          }
        }
      }),
    );
  },
);
