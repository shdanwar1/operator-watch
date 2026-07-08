import { createServerFn } from "@tanstack/react-start";

export const getGoogleClientId = createServerFn({ method: "GET" }).handler(async () => {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_OAUTH_CLIENT_ID not configured");
  return { clientId };
});
