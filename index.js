export default {
  async fetch(request, env, ctx) {
    // Usa el binding ASSETS para buscar el archivo solicitado
    const url = new URL(request.url);
    let pathname = url.pathname;

    // Si piden "/", devolvemos index.html
    if (pathname === "/") {
      pathname = "/index.html";
    }

    // Intentamos obtener el archivo desde ASSETS
    const response = await env.ASSETS.fetch(request);

    // Si existe, lo devolvemos tal cual
    if (response.status === 200) {
      return response;
    }

    // Si no existe, devolvemos un 404
    return new Response("404 - Archivo no encontrado", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  },
};


