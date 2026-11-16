import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatGPTPlanAuthStorage, CHATGPT_PLAN_BASE_URL } from './chatgpt-plan-auth.js';
import { CodexModelDiscoveryClient } from './connectivity/codex-model-discovery.js';
import { initializeModelSystem } from './initialize.js';
import type { LocalRuntimeConfig, ModelSystemConfigPort } from './contracts.js';
import { Type } from '@sinclair/typebox';
import type { Context } from '@earendil-works/pi-ai';
import { modelRefForModel } from './resolution/model-ref.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'test-key',
  alg: 'RS256',
  use: 'sig',
};

function harness(
  options: {
    permission?: boolean;
    wrongNonce?: boolean;
    wrongSubject?: boolean;
    expired?: boolean;
    tampered?: boolean;
    wrongAudience?: boolean;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'bari-chatgpt-plan-'));
  roots.push(root);
  const path = join(root, 'chatgpt-plan-credentials.json');
  let authorization: URL;
  let refreshCount = 0;
  const token = () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString(
      'base64url',
    );
    const claims = Buffer.from(
      JSON.stringify({
        iss: 'https://auth.openai.com',
        aud: options.wrongAudience ? 'other-client' : 'oaiapp_bari_test',
        sub: options.wrongSubject && refreshCount > 0 ? 'other-subject' : 'test-subject',
        nonce: options.wrongNonce ? 'wrong' : authorization.searchParams.get('nonce'),
        exp: Math.floor(Date.now() / 1000) + (options.expired ? -60 : 3600),
        email: 'test@example.invalid',
      }),
    ).toString('base64url');
    return `${header}.${claims}.${sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey).toString('base64url')}${options.tampered ? 'bad' : ''}`;
  };
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/openid-configuration'))
      return Response.json({
        issuer: 'https://auth.openai.com',
        jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
        revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke',
      });
    if (url.endsWith('/jwks.json')) return Response.json({ keys: [jwk] });
    if (url.endsWith('/oauth/revoke')) return new Response(null, { status: 200 });
    if (url.endsWith('/oauth/token')) {
      const params = new URLSearchParams(String(init?.body));
      if (params.get('grant_type') === 'refresh_token') refreshCount++;
      return Response.json({
        token_type: 'Bearer',
        access_token: `access-${refreshCount}`,
        refresh_token: `refresh-${refreshCount}`,
        expires_in: 3600,
        id_token: token(),
        scope: options.permission === false ? 'openid email' : 'openid chatgpt.tokens.use.direct',
      });
    }
    if (url.endsWith('/models'))
      return Response.json({
        models: [
          {
            slug: 'gpt-test',
            display_name: 'GPT Test',
            visibility: 'list',
            context_window: 123_456,
            supported_reasoning_levels: [{ effort: 'high' }],
          },
          { slug: 'hidden', visibility: 'hidden' },
        ],
      });
    throw new Error(`Unexpected test endpoint: ${url}`);
  });
  const storage = new ChatGPTPlanAuthStorage(path, fetchImpl);
  const controller = new AbortController();
  const callbacks = {
    onAuth: vi.fn(({ url }: { url: string }) => {
      authorization = new URL(url);
    }),
    onSelect: vi.fn(async () => 'browser'),
    onDeviceCode: vi.fn(),
    onPrompt: vi.fn(async () => ''),
    signal: controller.signal,
  };
  const start = async () => {
    const completion = storage.login('openai-codex', callbacks);
    void completion.catch(() => {});
    await vi.waitFor(() => expect(callbacks.onAuth).toHaveBeenCalled());
    return { completion };
  };
  const callback = async (params: Record<string, string> = {}) => {
    const url = new URL(authorization.searchParams.get('redirect_uri')!);
    url.search = new URLSearchParams({
      state: authorization.searchParams.get('state')!,
      code: 'one-time-code',
      client_id: 'oaiapp_bari_test',
      ...params,
    }).toString();
    return fetch(url);
  };
  const read = () => JSON.parse(readFileSync(path, 'utf8'));
  return {
    root,
    path,
    storage,
    fetchImpl,
    controller,
    callbacks,
    start,
    callback,
    read,
    authorization: () => authorization,
    refreshCount: () => refreshCount,
  };
}

describe('ChatGPT plan registration and credentials', () => {
  it('does not save a late token response after cancellation', async () => {
    const h = harness();
    const original = h.fetchImpl.getMockImplementation()!;
    let release: (() => void) | undefined;
    h.fetchImpl.mockImplementation(async (input, init) => {
      const response = await original(input, init);
      if (String(input).endsWith('/oauth/token'))
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return response;
    });
    const { completion } = await h.start();
    await h.callback();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    h.controller.abort();
    release!();
    await expect(completion).rejects.toThrow();
    expect(h.read().tokens).toBeUndefined();
    expect(h.storage.hasOAuth()).toBe(false);
  });

  it('does not let another process resurrect a sign-in after local sign-out', async () => {
    const h = harness();
    const { completion } = await h.start();
    await new ChatGPTPlanAuthStorage(h.path, h.fetchImpl).removeOAuth();
    await h.callback();
    await expect(completion).rejects.toThrow('replaced by another session');
    expect(h.fetchImpl).not.toHaveBeenCalled();
    expect(h.read().tokens).toBeUndefined();
  });
  it('drives the product resolver through catalog migration, inference, a local tool result and a second completed response', async () => {
    const h = harness();
    const { completion } = await h.start();
    await h.callback();
    await completion;
    const config = {
      dataDir: h.root,
      beta: { codexOAuth: true },
      provider: {},
      custom_provider: {
        'openai-codex': {
          api: 'openai-codex-responses',
          options: { baseURL: 'https://chatgpt.com/backend-api' },
          models: { obsolete: {} },
        },
      },
    } as LocalRuntimeConfig;
    const requests: Array<{ headers: Headers; payload: Record<string, any> }> = [];
    const original = h.fetchImpl.getMockImplementation()!;
    h.fetchImpl.mockImplementation(async (input, init) => {
      if (!String(input).endsWith('/responses')) return original(input, init);
      requests.push({
        headers: new Headers(init?.headers),
        payload: JSON.parse(String(init?.body)),
      });
      const first = requests.length === 1;
      const item = first
        ? {
            id: 'fc_test',
            type: 'function_call',
            call_id: 'call_test',
            namespace: 'bari',
            name: 'read_file',
            arguments: '{"path":"fixture.txt"}',
            status: 'completed',
          }
        : {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'fixture received', annotations: [] }],
            status: 'completed',
          };
      const events = [
        { type: 'response.created', response: { id: `resp_${requests.length}` } },
        { type: 'response.output_item.added', output_index: 0, item },
        ...(!first
          ? [
              {
                type: 'response.output_text.delta',
                output_index: 0,
                content_index: 0,
                delta: 'fixture received',
              },
            ]
          : []),
        { type: 'response.output_item.done', output_index: 0, item },
        {
          type: 'response.completed',
          response: {
            id: `resp_${requests.length}`,
            status: 'completed',
            usage: {
              input_tokens: 5,
              output_tokens: 2,
              total_tokens: 7,
              input_tokens_details: { cached_tokens: 0 },
            },
          },
        },
      ];
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    const owner = initializeModelSystem({
      fetchImpl: h.fetchImpl,
      config: {
        read: () => config,
        updateByok: async (mutate) => {
          const draft = { custom_provider: structuredClone(config.custom_provider) };
          await mutate(draft, config);
          config.custom_provider = draft.custom_provider as LocalRuntimeConfig['custom_provider'];
        },
      } as ModelSystemConfigPort,
    });
    await owner.oauth.startLogin();
    const provider = config.custom_provider!['openai-codex']!;
    expect(provider.api).toBe('openai-responses');
    expect(provider.options?.baseURL).toBe(CHATGPT_PLAN_BASE_URL);
    expect(Object.keys(provider.models!)).toEqual(['gpt-test']);
    const resolved = await owner.resolver.resolveModel({
      sessionId: 'plan-test',
      turnId: 'turn-1',
      agentConfig: {
        agent_id: 'test',
        system_prompt: 'Use local tools.',
        tools: [],
        skills: [],
        model: modelRefForModel(
          'custom_provider:openai-codex',
          'gpt-test',
          provider.models!['gpt-test']!,
        ),
      },
    });
    const context: Context = {
      systemPrompt: 'Use local tools.',
      messages: [{ role: 'user', content: 'read fixture', timestamp: 0 }],
      tools: [
        {
          name: 'read_file',
          description: 'Read a local fixture',
          parameters: Type.Object({ path: Type.String() }),
        },
      ],
    };
    const options = { apiKey: resolved.apiKey, fetch: resolved.fetch, headers: resolved.headers };
    const first = await (await resolved.streamFn!(resolved.model, context, options)).result();
    expect(first.stopReason).toBe('toolUse');
    const call = first.content.find((block) => block.type === 'toolCall')!;
    expect(call.name).toBe('read_file');
    context.messages.push(first, {
      role: 'toolResult',
      toolCallId: call.id,
      toolName: call.name,
      content: [{ type: 'text', text: 'synthetic fixture content' }],
      isError: false,
      timestamp: 1,
    });
    const second = await (await resolved.streamFn!(resolved.model, context, options)).result();
    expect(second.stopReason).toBe('stop');
    expect(second.content).toContainEqual(
      expect.objectContaining({ type: 'text', text: 'fixture received' }),
    );
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.headers.get('authorization')).toBe('Bearer access-0');
      expect(request.payload).toMatchObject({
        store: false,
        stream: true,
        tools: [{ type: 'namespace', name: 'bari' }],
      });
      expect(request.payload).not.toHaveProperty('max_output_tokens');
    }
    expect(requests[1]!.payload.input).toContainEqual(
      expect.objectContaining({ type: 'function_call', namespace: 'bari' }),
    );
    expect(requests[1]!.payload.input).toContainEqual(
      expect.objectContaining({
        type: 'function_call_output',
        output: 'synthetic fixture content',
      }),
    );
    expect(JSON.stringify(config)).not.toContain('access-0');
  });
  it('registers Bari with PKCE and validates identity before saving profile tokens', async () => {
    const h = harness();
    const { completion } = await h.start();
    const url = h.authorization();
    expect(url.origin + url.pathname).toBe('https://auth.openai.com/api/accounts/authorize');
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(url.searchParams.get('agent_name_hint')).toBe('Bari');
    expect(url.searchParams.get('ext_agent_host_id')).toMatch(/^urn:uuid:/);
    expect(url.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
    expect(url.searchParams.get('resource')).toBe(CHATGPT_PLAN_BASE_URL);
    expect(h.storage.hasOAuth()).toBe(false);
    expect((await h.callback()).status).toBe(200);
    await completion;
    expect(h.storage.hasOAuth()).toBe(true);
    expect(await h.storage.getCredentials()).toEqual({
      access: 'access-0',
      accountId: 'test-subject',
    });
    const exchange = h.fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/oauth/token'))!;
    const params = new URLSearchParams(String(exchange[1]?.body));
    expect(params.get('client_id')).toBe('oaiapp_bari_test');
    expect(params.get('redirect_uri')).toBe(url.searchParams.get('redirect_uri'));
    expect(params.get('client_secret')).toBeNull();
    expect(h.read().subject).toBe('test-subject');
    expect(h.read().tokens.refresh).toBe('refresh-0');
  });

  it.each([
    { permission: false },
    { wrongNonce: true },
    { expired: true },
    { tampered: true },
    { wrongAudience: true },
  ])('rejects invalid identity or missing inference consent: %j', async (options) => {
    const h = harness(options);
    const { completion } = await h.start();
    await h.callback();
    await expect(completion).rejects.toThrow();
    expect(h.storage.hasOAuth()).toBe(false);
    expect(h.read().tokens).toBeUndefined();
  });

  it('does not redeem an unverified callback and closes the listener on cancellation', async () => {
    const h = harness();
    const { completion } = await h.start();
    expect((await h.callback({ state: randomUUID() })).status).toBe(400);
    expect(h.fetchImpl).not.toHaveBeenCalled();
    h.controller.abort();
    await expect(completion).rejects.toThrow('cancelled');
    expect(h.storage.hasOAuth()).toBe(false);
    await expect(h.callback()).rejects.toThrow();
  });

  it('handles declined sign-in without exchanging a code', async () => {
    const h = harness();
    const { completion } = await h.start();
    await h.callback({ error: 'access_denied' });
    await expect(completion).rejects.toThrow('declined');
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it('serializes rotating refresh tokens across storage instances', async () => {
    const h = harness();
    const { completion } = await h.start();
    await h.callback();
    await completion;
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_550_000);
    try {
      const second = new ChatGPTPlanAuthStorage(h.path, h.fetchImpl);
      const credentials = await Promise.all([h.storage.getCredentials(), second.getCredentials()]);
      expect(credentials.map((value) => value?.access)).toEqual(['access-1', 'access-1']);
      expect(h.refreshCount()).toBe(1);
      expect(h.read().tokens.refresh).toBe('refresh-1');
    } finally {
      now.mockRestore();
    }
  });

  it('revokes locally saved tokens and retains the issued client and host for returning sign-in', async () => {
    const h = harness();
    const { completion } = await h.start();
    await h.callback();
    await completion;
    const hostId = h.read().hostId;
    await h.storage.removeOAuth();
    expect(h.read()).toMatchObject({ clientId: 'oaiapp_bari_test', hostId });
    expect(h.read().tokens).toBeUndefined();
    expect(await h.storage.getCredentials()).toBeUndefined();
    const revoke = h.fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/oauth/revoke'))!;
    expect(new URLSearchParams(String(revoke[1]?.body)).get('token')).toBe('refresh-0');
    h.callbacks.onAuth.mockClear();
    const returning = await h.start();
    expect(h.authorization().searchParams.get('client_id')).toBe('oaiapp_bari_test');
    expect(h.authorization().searchParams.get('agent_name_hint')).toBeNull();
    expect(h.authorization().searchParams.get('ext_agent_host_id')).toBe(hostId);
    h.controller.abort();
    await expect(returning.completion).rejects.toThrow();
  });

  it('uses the public account model catalog without backend-api or Codex-only headers', async () => {
    const h = harness();
    const catalog = await new CodexModelDiscoveryClient(h.fetchImpl, 1000, true).discover({
      access: 'test-token',
      accountId: 'subject',
    });
    expect(h.fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer test-token',
          Accept: 'application/json',
        },
        redirect: 'error',
      }),
    );
    expect(catalog).toMatchObject({
      api: 'openai-responses',
      kind: 'oauth',
      options: { baseURL: CHATGPT_PLAN_BASE_URL },
    });
    expect(Object.keys(catalog.models!)).toEqual(['gpt-test']);
  });

  it('wires browser sign-in into the product model-system owner', () => {
    const h = harness();
    const config = {
      dataDir: h.root,
      beta: { codexOAuth: true },
    } as LocalRuntimeConfig;
    const owner = initializeModelSystem({
      config: { read: () => config } as ModelSystemConfigPort,
      fetchImpl: h.fetchImpl,
    });
    expect(owner.oauth.getStatus()).toMatchObject({
      state: 'disconnected',
      displayName: 'ChatGPT subscription',
      availableMethods: ['browser'],
    });
    return expect(owner.oauth.startLogin({ method: 'device_code' })).rejects.toMatchObject({
      code: 'OAUTH_INVALID_METHOD',
    });
  });
});
