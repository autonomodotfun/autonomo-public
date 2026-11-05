import type { Metadata } from "next";
import Link from "next/link";
import { compact } from "@/components/project-row";
import { CATEGORY_INFO } from "@/lib/categories";
import { CATEGORIES } from "@/lib/constants";
import { getStats } from "@/lib/queries";
import { verifiedEnabled } from "@/lib/verified";
import { Code, Page, Section, Table } from "../ui";

export const metadata: Metadata = {
  title: "The x402 directory",
  description:
    "What's in Autonomo's x402 directory, how to search it, what each project page shows, where the data comes from, and how to get your project listed or fixed.",
};

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://autonomo.fun";

const SEARCH_CODE = `const res = await fetch("${SITE}/api/v1/projects?q=weather&network=base&sort=price&limit=5");
const { data } = await res.json(); // name, website, category, networks, minPriceUsd, calls30d, ...`;

export default async function DirectoryGuidePage() {
  const stats = await getStats();
  const categories = CATEGORIES.filter((c) => (stats.categories[c] ?? 0) > 0);
  return (
    <Page eyebrow="Docs" title="The x402 directory">
      <p>
        The <Link href="/projects">directory</Link> is a map of the x402 ecosystem: the paid APIs agents can buy from, and
        the facilitators, SDKs and tools around them. It tracks {compact(stats.projects)} projects with{" "}
        {compact(stats.endpoints)} paid endpoints, which handled {compact(stats.calls30d)} paid calls in the last 30 days.
        Anyone can browse it, and agents can search it for free.
      </p>

      <Section id="contents" title="What's in it">
        <Table
          rows={categories.map((c) => [
            <Link key={c} href={`/projects?category=${c}`} className="font-medium whitespace-nowrap">
              {CATEGORY_INFO[c].plural}
            </Link>,
            <>
              {CATEGORY_INFO[c].blurb}. <span className="font-mono text-xs text-faint">{compact(stats.categories[c] ?? 0)}</span>
            </>,
          ])}
        />
        <p>
          Paid services make up most of it. Each one is a single project per website, with all of its paid endpoints
          inside. Autonomo&apos;s own gateways, including the <Link href="/docs/official-apis">official APIs</Link>, are
          listed here too.
        </p>
      </Section>

      <Section id="search" title="Finding an API">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <b>Search</b> by what you need, such as <i>weather</i>, <i>image generation</i> or <i>token price</i>. It looks at
            names, descriptions, websites and tags.
          </li>
          <li>
            <b>Filter</b> by category and by network. Each filter shows how many projects it has, and filters combine
            with a search.
          </li>
          <li>
            <b>Sort</b> by <b>Most used</b> (paid calls in the last 30 days, the default), <b>Newest</b>,{" "}
            <b>Cheapest</b> (lowest price per call) or <b>A–Z</b>. When you search, <b>Relevance</b> is added and used
            first.
          </li>
          <li>
            <b>Tags</b> on a project page, like <code>#weather</code>, open a search for similar projects.
          </li>
        </ul>
        <p>
          The header links go straight to <Link href="/projects?category=facilitator">Facilitators</Link> and{" "}
          <Link href="/projects?category=sdk">SDKs</Link>.
        </p>
      </Section>

      <Section id="project-pages" title="What a project page shows">
        <ul className="list-disc space-y-2 pl-5">
          <li>Its name, description and links to its website, docs and GitHub, where known.</li>
          <li>Its category, the networks it takes payment on, its starting price and its paid calls in the last 30 days.</li>
          <li>
            <b>Paid endpoints:</b> each endpoint&apos;s method and path, what it does, its price per request, network,
            facilitator and paid calls over 30 days, busiest first (up to 500).
          </li>
          {verifiedEnabled() && (
            <li>
              A <b>Verified</b> badge on Autonomo gateways whose provider holds the required{" "}
              <Link href="/docs/token#verified">amount of $AUTONOMO</Link>. It shows they hold the token; it isn&apos;t a
              review of the API.
            </li>
          )}
        </ul>
      </Section>

      <Section id="data" title="Where the data comes from">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <b>Paid services</b> come from the Coinbase CDP and PayAI Bazaar discovery catalogs, which list the x402
            endpoints their facilitators have settled payments for. Endpoints are grouped into one project per host.
          </li>
          <li>
            <b>Autonomo gateways</b> appear once their owner requests a listing from the dashboard and it is approved.
          </li>
          <li>
            <b>Ecosystem projects</b>, such as facilitators, SDKs, extensions and explorers, are added and checked by hand.
          </li>
          <li>
            <b>Usage numbers</b> are paid calls reported by facilitators over the last 30 days.
          </li>
          <li>
            The catalogs are re-imported every 3 days, so new endpoints can take a few days to appear. Testnet-only
            services are hidden.
          </li>
        </ul>
        <p className="text-sm text-muted">
          A project being listed doesn&apos;t mean Autonomo has reviewed it. Check an API before you rely on it.
        </p>
      </Section>

      <Section id="get-listed" title="Getting your project in, or fixing it">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <b>You have an API and no x402 yet:</b> launch it from the dashboard and request a listing. See{" "}
            <Link href="/docs/launch">Launch from the dashboard</Link>.
          </li>
          <li>
            <b>You run x402 already:</b> register with a facilitator that supports Bazaar discovery and it&apos;s imported
            automatically, or use the <Link href="/submit">launch form</Link>. See{" "}
            <Link href="/docs/self-hosted">Run x402 yourself</Link>.
          </li>
          <li>
            <b>You build an SDK, facilitator, wallet or tool:</b> send it through the <Link href="/submit">launch form</Link>.
          </li>
          <li>
            <b>Something&apos;s wrong or out of date:</b> open the project page and choose <b>Suggest an edit</b>. Edits are
            reviewed by hand, and a corrected name or category is kept when the catalogs refresh.
          </li>
        </ul>
      </Section>

      <Section id="api" title="Using it from code">
        <p>
          The same directory is available as a free JSON API: no key, open CORS, cached for 5 minutes. Search projects,
          fetch one project with its endpoints, or get the totals.
        </p>
        <Code code={SEARCH_CODE} lang="ts" />
        <p>
          Every endpoint and parameter is on the <Link href="/api-docs">API reference</Link>. To pay for the APIs you
          find, see <Link href="/docs/agents">Use Autonomo from your agent</Link>.
        </p>
      </Section>
    </Page>
  );
}
