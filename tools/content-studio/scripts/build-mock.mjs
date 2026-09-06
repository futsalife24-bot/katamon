import { build } from 'vite';
import { readFile } from 'node:fs/promises';
const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
process.env.VITE_REPOSITORY_MODE='mock';
process.env.VITE_APP_VERSION=version;
process.env.VITE_API_BASE_URL='';
await build({mode:'production-mock',envDir:false});
