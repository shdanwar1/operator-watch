import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  // DMC authenticates with its own two-stage gate (shared site password +
  // operator PIN, see src/lib/gate.functions.ts) carried in a signed cookie.
  // No server function reads a Supabase user session, so client RPCs carry no
  // bearer token and no per-call session lookup is needed.
  functionMiddleware: [],
  requestMiddleware: [errorMiddleware],
}));
