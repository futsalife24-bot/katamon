import { preflight } from './preflight.js';
try {
  const {release}=await preflight();
  process.stdout.write(JSON.stringify({ok:true,mode:release.manifest.mode,version:release.manifest.version,sourceSha:release.manifest.sourceSha,staticBytes:[...release.files.values()].reduce((n,f)=>n+f.bytes.length,0),githubReadiness:'not_checked'})+'\n');
} catch(error) {
  const message=error instanceof Error && /^(?:NODE_ENV|PUBLIC_APP_URL|GITHUB_|ALLOWED_|SESSION_|OAUTH_|PREPARATION_|ADDITIONAL_|TRUSTED_|TRUST_PROXY|RATE_|MAX_|PORT|HOST|RELEASE_)/.test(error.message)?error.message:'RELEASE_FILES: rebuild the server distribution and check required settings';
  process.stderr.write(message+'\n');process.exitCode=1;
}
