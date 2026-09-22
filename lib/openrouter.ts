/**
 * The model config for an OpenRouter model id, shared by every agent in
 * lib/tutor.ts. Mastra's model router reads OPENROUTER_API_KEY itself; no AI
 * SDK provider package is involved.
 */
export function openRouterModel(id: `openrouter/${string}`) {
  return {
    id,
    // OPENROUTER_BASE_URL routes the traffic through a local proxy (mitmproxy
    // in reverse mode, see .env.example). A custom url switches off the
    // router's own key lookup, so hand the key over.
    ...(process.env.OPENROUTER_BASE_URL && {
      url: process.env.OPENROUTER_BASE_URL,
      apiKey: process.env.OPENROUTER_API_KEY,
    }),
  };
}
