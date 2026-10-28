export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";
}

/** "api.nansen.ai" -> "nansen.ai"; strips www./api. style prefixes for display and grouping hints. */
export function displayHost(host: string): string {
  return host.replace(/^(www|api|app)\./, "");
}
