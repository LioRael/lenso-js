import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { generateClientTypes } from '../dist/generate.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('client generation', () => {
  test('emits only operations in the explicit public OpenAPI document', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lenso-web-client-'));
    temporaryDirectories.push(directory);
    const input = join(directory, 'openapi.json');
    const output = join(directory, 'generated', 'api.ts');
    await writeFile(input, JSON.stringify(publicDocument()));

    const result = await generateClientTypes({ input, output });
    const generated = await readFile(output, 'utf8');

    expect(result.operationCount).toBe(2);
    expect(generated).toContain('"/notes"');
    expect(generated).toContain('notes.list');
    expect(generated).not.toContain('lenso.config');
    expect(generated).toContain(`Source SHA-256: ${result.digest}`);
  });

  test('rejects unstable and unsupported public documents', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lenso-web-client-'));
    temporaryDirectories.push(directory);
    const input = join(directory, 'openapi.json');
    const output = join(directory, 'api.ts');
    const document: any = publicDocument();
    delete document.paths['/notes'].get.operationId;
    await writeFile(input, JSON.stringify(document));
    await expect(generateClientTypes({ input, output })).rejects.toThrow('stable operationId');

    document.paths['/notes'].get.operationId = 'notes.list';
    document.webhooks = { changed: {} };
    await writeFile(input, JSON.stringify(document));
    await expect(generateClientTypes({ input, output })).rejects.toThrow('webhooks are not supported');
  });

  test('rejects external references before the generator can read them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lenso-web-client-'));
    temporaryDirectories.push(directory);
    const input = join(directory, 'openapi.json');
    const output = join(directory, 'api.ts');
    const document: any = publicDocument();
    document.components = { schemas: { Note: { $ref: 'https://metadata.invalid/schema.json' } } };
    await writeFile(input, JSON.stringify(document));
    await expect(generateClientTypes({ input, output })).rejects.toThrow('self-contained');
  });

  test('accepts self-contained OpenAPI 3.1 anchor references', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lenso-web-client-'));
    temporaryDirectories.push(directory);
    const input = join(directory, 'openapi.json');
    const output = join(directory, 'api.ts');
    const document: any = publicDocument();
    document.components = { schemas: { Note: { $anchor: 'Note', type: 'object' } } };
    document.paths['/notes'].get.responses['200'].content['application/json'].schema = { $ref: '#Note' };
    await writeFile(input, JSON.stringify(document));

    await expect(generateClientTypes({ input, output })).resolves.toMatchObject({ operationCount: 2 });
  });

  test('generated 200 JSON results unwrap without exact optional-property typing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lenso-web-client-types-'));
    temporaryDirectories.push(directory);
    const input = join(directory, 'openapi.json');
    const output = join(directory, 'generated.ts');
    const consumer = join(directory, 'consumer.ts');
    const document: any = publicDocument();
    document.paths['/notes'].get.responses['200'].content['application/json'].schema = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    };
    document.paths['/notes'].get.responses['400'] = {
      description: 'Invalid request',
      content: { 'application/problem+json': { schema: {
        type: 'object',
        required: ['type', 'title', 'status', 'detail', 'code'],
        properties: {
          type: { type: 'string' },
          title: { type: 'string' },
          status: { const: 400 },
          detail: { type: 'string' },
          code: { type: 'string', enum: ['invalid_path_parameters'] },
        },
        additionalProperties: false,
      } } },
    };
    document.paths = {
      '/notes/{note_id}': { get: {
        ...document.paths['/notes'].get,
        parameters: [{ name: 'note_id', in: 'path', required: true, schema: { type: 'string' } }],
      } },
      '/empty': { delete: {
        operationId: 'notes.empty',
        responses: { '204': { description: 'No content' } },
      } },
    };
    await writeFile(input, JSON.stringify(document));
    await generateClientTypes({ input, output });

    const runtime = relative(directory, resolve(import.meta.dir, '../dist/index.js')).replaceAll('\\', '/');
    await writeFile(consumer, `
import { createLensoWebClient, unwrap } from ${JSON.stringify(runtime)};
import type { paths } from './generated.js';
const api = createLensoWebClient<paths>({
  baseUrl: 'https://app.example.test',
  authentication: { kind: 'bearer', accessToken: () => 'test-token' },
});
async function readNote() {
  const note = unwrap(await api.GET('/notes/{note_id}', { params: { path: { note_id: 'note-1' } } }));
  type IsAny<T> = 0 extends (1 & T) ? true : false;
  type ExpectFalse<T extends false> = T;
  type NoteIsNotAny = ExpectFalse<IsAny<typeof note>>;
  const id: string = note.id;
  const explicit = unwrap<{ id: string }>(await api.GET('/notes/{note_id}', {
    params: { path: { note_id: 'note-1' } },
  }));
  const explicitId: string = explicit.id;
  void explicitId;
  const bodyless = unwrap(await api.DELETE('/empty'));
  const onlyUndefined: undefined = bodyless;
  // @ts-expect-error A no-content success cannot be treated as a JSON body.
  const notNumber: number = bodyless;
  void onlyUndefined;
  void notNumber;
  return id;
}
void readNote;
`);
    const config = join(directory, 'tsconfig.json');
    await writeFile(config, JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: true,
        exactOptionalPropertyTypes: false,
        module: 'ESNext',
        moduleResolution: 'Bundler',
        target: 'ES2022',
        skipLibCheck: true,
      },
      files: [consumer, output],
    }));

    for (const compiler of ['typescript', 'typescript-5']) {
      const binary = resolve(import.meta.dir, `../../../node_modules/${compiler}/bin/tsc`);
      const result = spawnSync('node', [binary, '-p', config], { encoding: 'utf8' });
      if (result.status !== 0) {
        throw new Error(`${compiler} rejected the generated client: ${result.stdout}${result.stderr}`);
      }
    }
  });
});

function publicDocument() {
  return {
    openapi: '3.1.0',
    info: { title: 'Knowledge Base', version: '1.0.0' },
    paths: {
      '/notes': {
        get: {
          operationId: 'notes.list',
          responses: { '200': { description: 'Notes', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
        post: {
          operationId: 'notes.create',
          responses: { '201': { description: 'Created', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
    },
  };
}
