import { spawn } from 'node:child_process';
const args = ['node_modules/vite/bin/vite.js'];
const build = spawn(process.execPath, [...args, 'build', '--outDir', 'test-results/server-mode-dist'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, VITE_REPOSITORY_MODE: 'server' } });
await new Promise((resolve, reject) => { build.once('exit', code => code === 0 ? resolve() : reject(new Error(`Server-mode test build exit ${code}`))); build.once('error',reject); });
const preview = spawn(process.execPath, [...args, 'preview', '--host', '127.0.0.1', '--port', '4176', '--strictPort', '--outDir', 'test-results/server-mode-dist'], { stdio: 'inherit', windowsHide: true });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => preview.kill());
preview.once('exit', code => process.exit(code ?? 1));
