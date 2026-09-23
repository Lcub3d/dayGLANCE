import { describe, expect, it } from 'vitest';
import { buildHonorTokenParams } from './honor-token.js';

const config = {
  clientId: 'app-id',
  clientSecret: 'server-secret',
  redirectUri: 'honorid://redirect_url',
};

describe('buildHonorTokenParams', () => {
  it('builds an authorization-code exchange without exposing extra client input', () => {
    const params = buildHonorTokenParams({
      grantType: 'authorization_code',
      code: 'one-time-code',
      redirectUri: 'https://attacker.invalid/',
    }, config);

    expect(Object.fromEntries(params)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'app-id',
      client_secret: 'server-secret',
      code: 'one-time-code',
      redirect_uri: 'honorid://redirect_url',
    });
  });

  it('builds a refresh-token exchange', () => {
    const params = buildHonorTokenParams({
      grantType: 'refresh_token',
      refreshToken: 'refresh-token',
    }, config);

    expect(Object.fromEntries(params)).toEqual({
      grant_type: 'refresh_token',
      client_id: 'app-id',
      client_secret: 'server-secret',
      refresh_token: 'refresh-token',
    });
  });

  it('fails closed for missing credentials or unsupported grant types', () => {
    expect(() => buildHonorTokenParams({ grantType: 'authorization_code' }, config))
      .toThrow('Missing authorization code');
    expect(() => buildHonorTokenParams({ grantType: 'refresh_token' }, config))
      .toThrow('Missing refresh token');
    expect(() => buildHonorTokenParams({ grantType: 'password' }, config))
      .toThrow('Unsupported grant type');
  });
});
