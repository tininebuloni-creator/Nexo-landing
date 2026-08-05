export default {
  async fetch(request, env, ctx) {
    // Devuelve el contenido de index.html
    return new Response(await env.ASSETS.fetch("index.html"), {
      headers: { "content-type": "text/html" },
    });
  }
};

