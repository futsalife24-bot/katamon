/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  readonly VITE_REPOSITORY_GATEWAY?: 'mock' | 'server';
  readonly VITE_SERVER_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
