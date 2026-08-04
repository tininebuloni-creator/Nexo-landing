export default {
  async fetch(request) {
    return new Response("Hola desde mi Worker!", {
      headers: { "content-type": "text/plain" },
    });
  },
};
