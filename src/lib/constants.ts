// Plain constants shared by server and client code (no database imports here).
export const CATEGORIES = [
  "service",
  "agent",
  "facilitator",
  "sdk",
  "extension",
  "tooling",
  "wallet",
  "explorer",
  "infrastructure",
] as const;
export type Category = (typeof CATEGORIES)[number];
