import { formatUsd, networkLabel } from "@/lib/networks";
import { DIRECT, listingEndpoints } from "@/lib/attach-endpoint";
import { attachListingEndpoint, detachListingEndpoint, moveListingEndpoint } from "./actions";

/** Adds paid endpoints to a directory listing from each endpoint's own 402, for listings that came from a submission. */
export async function DirectoryTab({ listing, message, move }: { listing?: string; message?: string; move?: { url: string; method: string } }) {
  const slug = listing?.trim() ?? "";
  const data = slug ? await listingEndpoints(slug) : null;

  return (
    <section id="endpoints">
      <h2 className="text-lg font-semibold">Add paid endpoints to a listing</h2>
      <p className="mt-1 text-sm text-muted">
        For an x402 API listed from a submission, which has only a description and links. Give a URL that answers 402:
        the price, chains, token and pay-to wallet are read from that answer, and nothing is paid. Add example query
        values if the API needs them to ask for payment; they aren&apos;t stored.
      </p>
      {message && (
        <div className="mt-3 rounded-md border border-line bg-surface p-3 text-sm break-words">
          <p>{message}</p>
          {move && data && (
            <form action={moveListingEndpoint} className="mt-2">
              <input type="hidden" name="slug" value={data.project.slug} />
              <input type="hidden" name="url" value={move.url} />
              <input type="hidden" name="method" value={move.method} />
              <button className="btn-brand px-3 py-1.5 text-xs">Move it to {data.project.name}</button>
            </form>
          )}
        </div>
      )}

      {/* Keyed by the listing shown, so the field always says which listing is open after a form sends you back here. */}
      <form key={slug} className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        <input type="hidden" name="tab" value="directory" />
        <label className="grid gap-1">
          Listing (the slug in /projects/…)
          <input name="listing" required defaultValue={slug} placeholder="qproof" spellCheck={false} className="field w-64 font-mono" />
        </label>
        <button className="rounded-md border border-line px-3 py-2">Show</button>
      </form>

      {slug && !data && <p className="mt-4 text-sm text-warn">No listing at /projects/{slug}.</p>}
      {data && (
        <div className="mt-4 rounded-lg border border-line bg-surface p-5 text-sm">
          <p className="font-medium">
            {data.project.name}{" "}
            <a href={`/projects/${data.project.slug}`} className="font-normal text-muted underline">
              /projects/{data.project.slug}
            </a>
          </p>
          <p className="mt-1 text-muted">
            {data.endpoints.length} {data.endpoints.length === 1 ? "endpoint" : "endpoints"}
            {data.project.networks.length > 0 && `, on ${data.project.networks.map(networkLabel).join(", ")}`}
          </p>

          {data.endpoints.length > 0 && (
            <ul className="mt-3 grid gap-2">
              {data.endpoints.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2">
                  <span className="font-mono text-xs break-all">
                    <span className="text-accent">{e.method}</span> {e.url}
                  </span>
                  <span className="font-mono text-xs">{formatUsd(e.priceUsd)}</span>
                  <span className="text-xs text-muted">{e.network ? networkLabel(e.network) : "no chain"}</span>
                  <span className="font-mono text-xs text-faint">{e.payTo}</span>
                  {e.facilitator === DIRECT ? (
                    <form action={detachListingEndpoint} className="ml-auto">
                      <input type="hidden" name="slug" value={data.project.slug} />
                      <input type="hidden" name="id" value={e.id} />
                      <button className="text-xs text-warn underline">Remove</button>
                    </form>
                  ) : (
                    <span className="ml-auto text-xs text-faint">from the {e.facilitator} import</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {data.project.source === "gateway" ? (
            <p className="mt-4 text-muted">This is an Autonomo gateway: its endpoint is managed by the gateway itself.</p>
          ) : (
            <form action={attachListingEndpoint} className="mt-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="slug" value={data.project.slug} />
              <label className="grid min-w-0 flex-1 gap-1">
                Endpoint URL that answers 402
                <input name="url" type="url" required placeholder="https://api.example.com/v1/thing?param=example" spellCheck={false} className="field font-mono" />
              </label>
              <label className="grid gap-1">
                Method
                <select name="method" defaultValue="GET" className="field w-24">
                  <option>GET</option>
                  <option>POST</option>
                </select>
              </label>
              <button className="btn-brand px-3 py-2">Add to {data.project.name}</button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
