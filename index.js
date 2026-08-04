export default {
  async fetch(request) {
    return new Response("Hola desde Nexo-landing!", {
      headers: { "content-type": "text/plain" },
    });
  },
};
