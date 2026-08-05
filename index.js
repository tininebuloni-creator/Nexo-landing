export default {
  async fetch(request, env, ctx) {
    return new Response(await env.ASSETS.fetch("index.html"), {
      headers: { "content-type": "text/html" },
    });
  }
};

