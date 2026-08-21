export default {
  async fetch(request, env) {
    if (env.ASSETS?.fetch) return env.ASSETS.fetch(request);
    return new Response('Tailor Scan static assets are unavailable.', { status: 503 });
  }
};
