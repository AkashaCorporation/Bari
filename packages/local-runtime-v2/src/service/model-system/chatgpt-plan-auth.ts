import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
  type JsonWebKey,
} from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import lockfile from 'proper-lockfile';
import type { OAuthLoginCallbacks } from '@earendil-works/pi-ai/oauth';

export const CHATGPT_PLAN_BASE_URL = 'https://api.openai.com/v1';
const ISSUER = 'https://auth.openai.com';
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';

/** Only application-authored, credential-free messages may reach sign-in status. */
export class ChatGPTPlanAuthError extends Error {}

interface PlanTokens {
  access: string;
  refresh: string;
  expires: number;
  idToken: string;
  scopes: string[];
}

interface PlanState {
  hostId: string;
  pendingLogin?: string;
  clientId?: string;
  subject?: string;
  email?: string;
  tokens?: PlanTokens;
}

/** One ChatGPT registration per Bari profile. Tokens never enter model configuration. */
export class ChatGPTPlanAuthStorage {
  constructor(
    private readonly path: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  hasOAuth(): boolean {
    const state = this.read();
    return Boolean(state?.subject && state.tokens?.scopes.includes(PLAN_SCOPE));
  }

  async getCredentials(): Promise<{ access: string; accountId: string } | undefined> {
    if (!this.hasOAuth()) return undefined;
    return this.locked(async () => {
      const state = this.read();
      if (!state?.tokens || !state.subject) return undefined;
      if (state.tokens.expires <= Date.now() + 60_000) {
        const response = await this.request(TOKEN_URL, {
          method: 'POST',
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: state.clientId!,
            refresh_token: state.tokens.refresh,
            resource: CHATGPT_PLAN_BASE_URL,
          }),
        });
        const payload = (await response.json()) as Record<string, unknown>;
        if (typeof payload.id_token === 'string') {
          await this.validateIdentity(payload.id_token, state.clientId!, undefined, state.subject);
        }
        state.tokens = this.parseTokens(payload, state.tokens);
        this.write(state);
      }
      if (!state.tokens.scopes.includes(PLAN_SCOPE)) {
        throw new ChatGPTPlanAuthError(
          'ChatGPT plan permission is missing. Reconnect and approve plan usage.',
        );
      }
      return { access: state.tokens.access, accountId: state.subject };
    });
  }

  async removeOAuth(): Promise<void> {
    const previous = await this.locked(async () => {
      const state = this.read();
      if (!state) return undefined;
      const tokens = state.tokens;
      delete state.tokens;
      delete state.pendingLogin;
      this.write(state);
      return tokens ? { tokens, clientId: state.clientId! } : undefined;
    });
    if (!previous) return;
    try {
      const discovery = await this.discovery();
      await this.request(this.authEndpoint(discovery.revocation_endpoint), {
        method: 'POST',
        body: new URLSearchParams({
          token: previous.tokens.refresh,
          token_type_hint: 'refresh_token',
          client_id: previous.clientId,
        }),
      });
    } catch {
      throw new ChatGPTPlanAuthError(
        'Signed out locally. Remote revocation was not confirmed; disconnect Bari in ChatGPT Settings.',
      );
    }
  }

  async login(_provider: string, callbacks: OAuthLoginCallbacks): Promise<void> {
    const signal = callbacks.signal ?? AbortSignal.timeout(15 * 60_000);
    signal.throwIfAborted();
    const attemptId = randomUUID();
    const state = await this.locked<PlanState>(async () => {
      const saved = this.read();
      const created = {
        ...(saved ?? { hostId: `urn:uuid:${randomUUID()}` }),
        pendingLogin: attemptId,
      };
      this.write(created);
      return created;
    });
    const transaction = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(64).toString('base64url');
    let resolveCallback!: (params: URLSearchParams) => void;
    let rejectCallback!: (error: Error) => void;
    const callback = new Promise<URLSearchParams>((resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    });
    // Attach a handler before publishing the URL or observing cancellation.
    void callback.catch(() => {});
    let consumed = false;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      if (request.method !== 'GET' || url.pathname !== '/auth/callback') {
        response.writeHead(404).end('Not found');
        return;
      }
      if (consumed) {
        response.writeHead(409).end('Sign-in already handled.');
        return;
      }
      const params = url.searchParams;
      if (params.getAll('state').length !== 1 || params.get('state') !== transaction) {
        response.writeHead(400).end('Sign-in could not be verified.');
        return;
      }
      consumed = true;
      response.end('Return to Bari to finish signing in.');
      resolveCallback(params);
    });
    const abort = () =>
      rejectCallback(new ChatGPTPlanAuthError('ChatGPT sign-in was cancelled or expired.'));
    signal.addEventListener('abort', abort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      server.on('error', rejectCallback);
      signal.throwIfAborted();
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new ChatGPTPlanAuthError('ChatGPT callback is unavailable.');
      const redirect = `http://127.0.0.1:${address.port}/auth/callback`;
      const authorize = new URL(`${ISSUER}/api/accounts/authorize`);
      authorize.search = new URLSearchParams({
        client_id: state.clientId ?? 'dynamic_agent_client',
        ...(state.clientId ? {} : { agent_name_hint: 'Bari' }),
        ext_agent_host_id: state.hostId,
        response_type: 'code',
        redirect_uri: redirect,
        scope: `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`,
        resource: CHATGPT_PLAN_BASE_URL,
        state: transaction,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        // Keep ID tokens out of the URL displayed in the terminal.
      }).toString();
      callbacks.onAuth({ url: authorize.toString() });
      const params = await callback;
      signal.throwIfAborted();
      if (params.has('error'))
        throw new ChatGPTPlanAuthError('ChatGPT sign-in was declined. Start sign-in again.');
      const clientId = params.get('client_id') ?? state.clientId;
      const code = params.get('code');
      if (
        !clientId ||
        !clientId.startsWith('oaiapp_') ||
        !code ||
        params.getAll('code').length !== 1 ||
        params.getAll('client_id').length > 1 ||
        (state.clientId && clientId !== state.clientId) ||
        (params.has('iss') && params.get('iss') !== ISSUER)
      ) {
        throw new ChatGPTPlanAuthError(
          'ChatGPT registration is incomplete or does not match this profile.',
        );
      }
      // Retain an issued registration even if its one-time code later expires.
      state.clientId = clientId;
      await this.locked(async () => {
        signal.throwIfAborted();
        this.requireAttempt(attemptId);
        this.write(state);
      });
      const response = await this.request(TOKEN_URL, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          code_verifier: verifier,
          redirect_uri: redirect,
          resource: CHATGPT_PLAN_BASE_URL,
        }),
        signal,
      });
      const payload = (await response.json()) as Record<string, unknown>;
      const tokens = this.parseTokens(payload);
      const identity = await this.validateIdentity(
        tokens.idToken,
        clientId,
        nonce,
        state.subject,
        signal,
      );
      signal.throwIfAborted();
      await this.locked(async () => {
        signal.throwIfAborted();
        this.requireAttempt(attemptId);
        delete state.pendingLogin;
        this.write({
          ...state,
          subject: identity.sub as string,
          ...(typeof identity.email === 'string' ? { email: identity.email } : {}),
          tokens,
        });
      });
    } finally {
      signal.removeEventListener('abort', abort);
      server.close();
      server.closeAllConnections();
    }
  }

  private parseTokens(payload: Record<string, unknown>, previous?: PlanTokens): PlanTokens {
    const scopes =
      typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : previous?.scopes;
    if (payload.token_type !== 'Bearer' && payload.token_type !== 'bearer') {
      throw new ChatGPTPlanAuthError('ChatGPT returned an unsupported token type.');
    }
    if (
      typeof payload.access_token !== 'string' ||
      !payload.access_token ||
      typeof payload.expires_in !== 'number' ||
      !Number.isFinite(payload.expires_in) ||
      payload.expires_in <= 0 ||
      !scopes?.includes(PLAN_SCOPE)
    ) {
      throw new ChatGPTPlanAuthError(
        'ChatGPT plan access was not granted. Reconnect and approve plan usage.',
      );
    }
    const refresh =
      typeof payload.refresh_token === 'string' ? payload.refresh_token : previous?.refresh;
    const idToken = typeof payload.id_token === 'string' ? payload.id_token : previous?.idToken;
    if (!refresh || !idToken)
      throw new ChatGPTPlanAuthError('ChatGPT returned incomplete sign-in credentials.');
    return {
      access: payload.access_token,
      refresh,
      idToken,
      scopes,
      expires: Date.now() + payload.expires_in * 1000,
    };
  }

  private async validateIdentity(
    token: string,
    clientId: string,
    nonce?: string,
    subject?: string,
    signal?: AbortSignal,
  ) {
    const invalid = () =>
      new ChatGPTPlanAuthError('ChatGPT identity could not be verified. Start sign-in again.');
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw invalid();
      const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
      if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit !== undefined)
        throw invalid();
      const discovery = await this.discovery(signal);
      const response = await this.request(this.authEndpoint(discovery.jwks_uri), { signal });
      const jwks = (await response.json()) as {
        keys?: Array<JsonWebKey & { kid?: string; use?: string; alg?: string }>;
      };
      const candidates = jwks.keys?.filter(
        (key) =>
          key.kid === header.kid &&
          key.kty === 'RSA' &&
          (!key.use || key.use === 'sig') &&
          (!key.alg || key.alg === 'RS256'),
      );
      if (candidates?.length !== 1) throw invalid();
      const key = createPublicKey({ key: candidates[0]!, format: 'jwk' });
      if (
        (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
        !verify(
          'RSA-SHA256',
          Buffer.from(`${parts[0]}.${parts[1]}`),
          key,
          Buffer.from(parts[2]!, 'base64url'),
        )
      )
        throw invalid();
      const identity = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
      const audiences = Array.isArray(identity.aud) ? identity.aud : [identity.aud];
      const now = Date.now() / 1000;
      if (
        identity.iss !== ISSUER ||
        !audiences.includes(clientId) ||
        (audiences.length > 1 && identity.azp !== clientId) ||
        typeof identity.exp !== 'number' ||
        !Number.isFinite(identity.exp) ||
        identity.exp <= now ||
        (identity.nbf !== undefined &&
          (typeof identity.nbf !== 'number' || identity.nbf > now + 60)) ||
        typeof identity.sub !== 'string' ||
        !identity.sub ||
        (nonce !== undefined && identity.nonce !== nonce) ||
        (subject !== undefined && identity.sub !== subject)
      )
        throw invalid();
      return identity as Record<string, unknown>;
    } catch {
      throw invalid();
    }
  }

  private async discovery(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const response = await this.request(`${ISSUER}/.well-known/openid-configuration`, { signal });
    const value = (await response.json()) as Record<string, unknown>;
    if (value.issuer !== ISSUER)
      throw new ChatGPTPlanAuthError('ChatGPT authorization issuer is invalid.');
    return value;
  }

  private authEndpoint(value: unknown): string {
    if (typeof value !== 'string' || new URL(value).origin !== ISSUER) {
      throw new ChatGPTPlanAuthError('ChatGPT authorization endpoint is invalid.');
    }
    return value;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([
          AbortSignal.timeout(30_000),
          ...(init.signal ? [init.signal] : []),
        ]),
      });
      if (!response.ok) throw new Error();
      return response;
    } catch {
      throw new ChatGPTPlanAuthError(
        'ChatGPT authorization request failed. Reconnect or retry sign-in.',
      );
    }
  }

  private read(): PlanState | undefined {
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as PlanState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new ChatGPTPlanAuthError('ChatGPT profile credentials could not be read.');
    }
  }

  private requireAttempt(attemptId: string): void {
    if (this.read()?.pendingLogin !== attemptId) {
      throw new ChatGPTPlanAuthError(
        'ChatGPT sign-in was cancelled or replaced by another session.',
      );
    }
  }

  private write(state: PlanState): void {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(state), {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.path);
    } finally {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }

  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.path, {
      realpath: false,
      retries: { retries: 40, minTimeout: 50, maxTimeout: 1000 },
      stale: 60_000,
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  }
}
