export default {
  async fetch(request, env, ctx) {
    
        return new Response(await env.ASSETS.fetch("index.html"), {
          headers: { "content-type": "text/html" },
        });

      case "/style.css":
        return new Response(await env.ASSETS.fetch("style.css"), {
          headers: { "content-type": "text/css" },
        });

      case "/logo.png":
        return new Response(await env.ASSETS.fetch("logo.png"), {
          headers: { "content-type": "image/png" },
        });

      case "/privacidad.html":
        return new Response(await env.ASSETS.fetch("privacidad.html"), {
          headers: { "content-type": "text/html" },
        });

      case "/terminos.html":
        return new Response(await env.ASSETS.fetch("terminos.html"), {
          headers: { "content-type": "text/html" },
        });

      default:
        return new Response("404 - Archivo no encontrado", {
          status: 404,
          headers: { "content-type": "text/plain" },
        });
    }
  },
};
