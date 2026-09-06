import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { loadProductionRelease } from './production-runtime.js';

export async function preflight(directory=fileURLToPath(new URL('.',import.meta.url))){
  const config=loadConfig();
  if(!config.production)throw new Error('NODE_ENV: set production before starting the distribution');
  if(!config.configured)throw new Error(config.configurationErrors.join('; '));
  const release=await loadProductionRelease(directory);
  return {config,release};
}
