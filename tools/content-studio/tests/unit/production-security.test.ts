import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../server/config';
import { OAuthStateManager } from '../../server/security';
import { serverTestConfig } from './server-fixtures';
import { createHash } from 'node:crypto';
import { GitHubClient } from '../../server/github-api';

describe('production security boundaries', () => {
  it('rejects URL normalization tricks rather than accepting them as an origin',()=>{
    for(const origin of ['https://studio.invalid/../','https://studio.invalid/?','https://studio.invalid/#','https://user:password@studio.invalid','https://studio.invalid\\path']){
      expect(loadConfig({NODE_ENV:'production',PUBLIC_APP_URL:origin}).configurationErrors.some(error=>error.startsWith('PUBLIC_APP_URL'))).toBe(true);
    }
    expect(loadConfig({NODE_ENV:'production',PUBLIC_APP_URL:'https://studio.invalid/'}).configurationErrors.some(error=>error.startsWith('PUBLIC_APP_URL'))).toBe(false);
    for(const [name,value] of [['MAX_REQUEST_BYTES','banana'],['MAX_FILES','33'],['MAX_FILE_BYTES','0'],['MAX_TOTAL_FILE_BYTES','999999999']])
      expect(loadConfig({NODE_ENV:'production',[name]:value}).configurationErrors.some(error=>error.startsWith(name))).toBe(true);
  });
  it('keeps the PKCE verifier out of state, binds S256, rejects another browser, expiry and restart',async()=>{
    let now=1000;const clock={now:()=>now};const manager=new OAuthStateManager('fixture-secret-of-at-least-32-characters',5000,clock);
    const state=manager.create('/tools/content-studio/'),challenge=manager.challenge(state);
    expect(()=>manager.verify(state,'other-cookie')).toThrow();
    const payload=manager.verify(state,state);expect(createHash('sha256').update(payload.verifier).digest('base64url')).toBe(challenge);
    expect(Buffer.from(state.split('.')[0],'base64url').toString()).not.toContain(payload.verifier);
    const calls:Record<string,unknown>[]=[];
    const client=new GitHubClient(serverTestConfig(),async(input,init)=>{if(String(input).endsWith('/access_token')){const body=JSON.parse(String(init?.body));calls.push(body);return Response.json({access_token:'fixture-only-ephemeral-token'});}return Response.json({login:'allowed-user',id:123});});
    const url=new URL(client.oauthAuthorizeUrl(state,challenge));expect(url.searchParams.get('code_challenge_method')).toBe('S256');expect(url.searchParams.get('code_challenge')).toBe(challenge);
    await client.authenticateOAuthCode('fixture-code',payload.verifier);expect(calls[0].code_verifier).toBe(payload.verifier);
    await expect(client.authenticateOAuthCode('fixture-code','bad')).rejects.toThrow();
    const expired=manager.create('/');now+=5000;expect(()=>manager.verify(expired,expired)).toThrow();
    const fresh=manager.create('/');expect(()=>new OAuthStateManager('fixture-secret-of-at-least-32-characters',5000,clock).verify(fresh,fresh)).toThrow();
  });
  it('consumes browser-bound OAuth state once', () => {
    const manager=new OAuthStateManager('dummy-stable-state-secret-more-than-32',5000);
    const state=manager.create('/tools/content-studio/');
    manager.verify(state,state);
    expect(()=>manager.verify(state,state)).toThrow();
  });
  it('never treats a production HTTP origin and placeholder private key as configured', () => {
    const c=serverTestConfig();
    const result=loadConfig({NODE_ENV:'production',PUBLIC_APP_URL:'http://localhost:4174',GITHUB_OWNER:c.githubOwner,GITHUB_REPO:c.githubRepo,GITHUB_OAUTH_CLIENT_ID:'dummy-client',GITHUB_OAUTH_CLIENT_SECRET:'dummy-secret',GITHUB_APP_ID:'1',GITHUB_INSTALLATION_ID:'2',GITHUB_PRIVATE_KEY:'not-a-key',ALLOWED_GITHUB_USERS:'fixture-user',SESSION_SECRET:'dummy-session-secret-at-least-32-characters'});
    expect(result.configured).toBe(false);
    expect(result.configurationErrors.some(e=>e.startsWith('PUBLIC_APP_URL'))).toBe(true);
    expect(result.configurationErrors.some(e=>e.startsWith('GITHUB_PRIVATE_KEY'))).toBe(true);
  });
});
