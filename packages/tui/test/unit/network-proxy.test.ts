import { describe, expect, it, vi } from 'vitest';

import {
  configureTuiNetworkProxy,
  resolveTuiProxyConfiguration,
  shouldBypassTuiProxy,
} from '../../src/cli/network-proxy.js';

describe('TUI network proxy resolution', () => {
  it('accepts scheme-less proxy values and normalizes them', () => {
    const configuration = resolveTuiProxyConfiguration({ HTTP_PROXY: 'proxy.corp:8080' });

    expect(configuration).toMatchObject({
      mode: 'proxy',
      httpProxy: 'http://proxy.corp:8080/',
      httpsProxy: 'http://proxy.corp:8080/',
    });
  });

  it('falls back to ALL_PROXY and prefers HTTPS_PROXY for https traffic', () => {
    expect(
      resolveTuiProxyConfiguration({ ALL_PROXY: 'http://all.corp:3128' }),
    ).toMatchObject({ httpProxy: 'http://all.corp:3128/', httpsProxy: 'http://all.corp:3128/' });

    expect(
      resolveTuiProxyConfiguration({
        HTTP_PROXY: 'http://plain.corp:3128',
        HTTPS_PROXY: 'http://secure.corp:3128',
      }),
    ).toMatchObject({ httpProxy: 'http://plain.corp:3128/', httpsProxy: 'http://secure.corp:3128/' });
  });

  it('rejects unsupported schemes and keeps the loopback bypass always enabled', () => {
    expect(() => resolveTuiProxyConfiguration({ HTTP_PROXY: 'ftp://proxy.corp:21' })).toThrow(
      /http/,
    );

    const configuration = resolveTuiProxyConfiguration({
      HTTPS_PROXY: 'http://proxy.corp:3128',
      NO_PROXY: '.example.com',
    });
    expect(configuration.mode).toBe('proxy');
    if (configuration.mode !== 'proxy') throw new Error('expected proxy mode');
    expect(configuration.noProxy).toContain('.example.com');
    expect(configuration.noProxy).toContain('localhost');
    expect(shouldBypassTuiProxy(new URL('http://localhost:5321/'), configuration.noProxy)).toBe(
      true,
    );
    expect(shouldBypassTuiProxy(new URL('https://api.example.com/'), configuration.noProxy)).toBe(
      true,
    );
    expect(shouldBypassTuiProxy(new URL('https://opencode.ai/'), configuration.noProxy)).toBe(
      false,
    );
  });

  it('installs a dispatcher and fetch patch only when a proxy is configured', () => {
    const setGlobalDispatcher = vi.fn();
    const installFetch = vi.fn();
    const dispatcher = { dispatch: vi.fn(), close: vi.fn(), destroy: vi.fn() };
    const createProxyDispatcher = vi.fn(() => dispatcher as never);

    const direct = configureTuiNetworkProxy({
      environment: {},
      setGlobalDispatcher,
      installFetch,
      createProxyDispatcher,
    });
    expect(direct.mode).toBe('direct');
    expect(setGlobalDispatcher).not.toHaveBeenCalled();
    expect(installFetch).not.toHaveBeenCalled();

    const proxied = configureTuiNetworkProxy({
      environment: { HTTPS_PROXY: 'http://proxy.corp:3128' },
      setGlobalDispatcher,
      installFetch,
      createProxyDispatcher,
    });
    expect(proxied.mode).toBe('proxy');
    expect(createProxyDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({ httpsProxy: 'http://proxy.corp:3128/' }),
    );
    expect(setGlobalDispatcher).toHaveBeenCalledWith(dispatcher);
    expect(installFetch).toHaveBeenCalledTimes(1);
  });
});
