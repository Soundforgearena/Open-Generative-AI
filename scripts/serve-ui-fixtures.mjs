// Test-only component host. It is never included in the Next.js application.
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  entryPoints: [`${root}tests/e2e/fixtures/r2-settings.jsx`],
  bundle: true, write: false, outfile: 'fixture.js',
  loader: { '.js': 'jsx' }, jsx: 'automatic',
  alias: { '@': root },
  external: ['/HERO.jpeg'],
  define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' },
});
createServer((request, response) => {
  if (request.url === '/fixture.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    response.end(result.outputFiles.find((file) => file.path.endsWith('.js')).text);
  } else if (request.url === '/fixture.css') {
    response.writeHead(200, { 'Content-Type': 'text/css' });
    response.end(result.outputFiles.find((file) => file.path.endsWith('.css')).text);
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;padding:30px;background:#11151b;color:#edf0f5}label{display:block}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  }
}).listen(3110, '127.0.0.1');
