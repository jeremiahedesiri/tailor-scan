import { readFile, mkdir, writeFile } from 'node:fs/promises';

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/silhouette-measurement.js': ['silhouette-measurement.js', 'text/javascript; charset=utf-8'],
  '/vision-provider.js': ['vision-provider.js', 'text/javascript; charset=utf-8']
  ,'/landmark-model.js': ['landmark-model.js', 'text/javascript; charset=utf-8']
  ,'/calibration.js': ['calibration.js', 'text/javascript; charset=utf-8']
  ,'/image-loader.js': ['image-loader.js', 'text/javascript; charset=utf-8']
  ,'/silhouette-utils.js': ['silhouette-utils.js', 'text/javascript; charset=utf-8']
  ,'/debug-visualization.js': ['debug-visualization.js', 'text/javascript; charset=utf-8']
  ,'/stage2-resolver.js': ['stage2-resolver.js', 'text/javascript; charset=utf-8']
  ,'/torso-profile.js': ['torso-profile.js', 'text/javascript; charset=utf-8']
  ,'/stage3-resolver.js': ['stage3-resolver.js', 'text/javascript; charset=utf-8']
  ,'/stage3b-validator.js': ['stage3b-validator.js', 'text/javascript; charset=utf-8']
  ,'/stage3c-refiner.js': ['stage3c-refiner.js', 'text/javascript; charset=utf-8']
  ,'/stage3d-refiner.js': ['stage3d-refiner.js', 'text/javascript; charset=utf-8']
  ,'/stage3e-refiner.js': ['stage3e-refiner.js', 'text/javascript; charset=utf-8']
  ,'/stage3f-refiner.js': ['stage3f-refiner.js', 'text/javascript; charset=utf-8']
  ,'/live-stage-l1.js': ['live-stage-l1.js', 'text/javascript; charset=utf-8']
  ,'/live-app.js': ['live-app.js', 'text/javascript; charset=utf-8']
};
const routes = {};
for (const [route, [file, contentType]] of Object.entries(files)) routes[route] = { body: await readFile(file, 'utf8'), contentType };
const worker = `const routes=${JSON.stringify(routes)};
export default { async fetch(request) {
  const url = new URL(request.url);
  const asset = routes[url.pathname];
  if (!asset) return new Response('Not found', { status: 404 });
  return new Response(asset.body, { headers: { 'content-type': asset.contentType, 'cache-control': url.pathname === '/' ? 'no-cache' : 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
} };\n`;
await mkdir('dist/server', { recursive: true });
await writeFile('dist/server/index.js', worker);
