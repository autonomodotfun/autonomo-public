// One line of the Agent Playground's NDJSON stream (shared by the API route and the page).
export type PlaygroundEvent =
  | { step: "search"; state: "running" | "fail"; detail: string }
  | { step: "search"; state: "done"; detail: string; api: { name: string; slug: string; url: string; description: string | null; autonomo: boolean } }
  | { step: "quote"; state: "running" | "fail"; detail: string }
  | { step: "quote"; state: "done"; detail: string; offers: { token: string; amount: string; network: string }[]; acceptsAutonomo: boolean }
  | { step: "pay" | "answer"; state: "soon"; detail: string }
  | { step: "end" };
