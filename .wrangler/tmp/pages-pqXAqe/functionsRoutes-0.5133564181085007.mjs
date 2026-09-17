import { onRequestOptions as __v1_client_activate_js_onRequestOptions } from "C:\\Users\\usuario\\Documents\\Proyectos\\Nexo-landing\\functions\\v1\\client\\activate.js"
import { onRequestPost as __v1_client_activate_js_onRequestPost } from "C:\\Users\\usuario\\Documents\\Proyectos\\Nexo-landing\\functions\\v1\\client\\activate.js"
import { onRequestOptions as __v1_client_activations_js_onRequestOptions } from "C:\\Users\\usuario\\Documents\\Proyectos\\Nexo-landing\\functions\\v1\\client\\activations.js"
import { onRequestPost as __v1_client_activations_js_onRequestPost } from "C:\\Users\\usuario\\Documents\\Proyectos\\Nexo-landing\\functions\\v1\\client\\activations.js"
import { onRequestGet as __v1_client_authorization_js_onRequestGet } from "C:\\Users\\usuario\\Documents\\Proyectos\\Nexo-landing\\functions\\v1\\client\\authorization.js"
import { onRequestOptions as __v1_client_authorization_js_onRequestOptions } from "C:\\Users\\usuario\\Documents\\Proyectos\\Nexo-landing\\functions\\v1\\client\\authorization.js"
import { onRequestOptions as __v1_client_release_js_onRequestOptions } from "C:\\Users\\usuario\\Documents\\Proyectos\\Nexo-landing\\functions\\v1\\client\\release.js"
import { onRequestPost as __v1_client_release_js_onRequestPost } from "C:\\Users\\usuario\\Documents\\Proyectos\\Nexo-landing\\functions\\v1\\client\\release.js"

export const routes = [
    {
      routePath: "/v1/client/activate",
      mountPath: "/v1/client",
      method: "OPTIONS",
      middlewares: [],
      modules: [__v1_client_activate_js_onRequestOptions],
    },
  {
      routePath: "/v1/client/activate",
      mountPath: "/v1/client",
      method: "POST",
      middlewares: [],
      modules: [__v1_client_activate_js_onRequestPost],
    },
  {
      routePath: "/v1/client/activations",
      mountPath: "/v1/client",
      method: "OPTIONS",
      middlewares: [],
      modules: [__v1_client_activations_js_onRequestOptions],
    },
  {
      routePath: "/v1/client/activations",
      mountPath: "/v1/client",
      method: "POST",
      middlewares: [],
      modules: [__v1_client_activations_js_onRequestPost],
    },
  {
      routePath: "/v1/client/authorization",
      mountPath: "/v1/client",
      method: "GET",
      middlewares: [],
      modules: [__v1_client_authorization_js_onRequestGet],
    },
  {
      routePath: "/v1/client/authorization",
      mountPath: "/v1/client",
      method: "OPTIONS",
      middlewares: [],
      modules: [__v1_client_authorization_js_onRequestOptions],
    },
  {
      routePath: "/v1/client/release",
      mountPath: "/v1/client",
      method: "OPTIONS",
      middlewares: [],
      modules: [__v1_client_release_js_onRequestOptions],
    },
  {
      routePath: "/v1/client/release",
      mountPath: "/v1/client",
      method: "POST",
      middlewares: [],
      modules: [__v1_client_release_js_onRequestPost],
    },
  ]