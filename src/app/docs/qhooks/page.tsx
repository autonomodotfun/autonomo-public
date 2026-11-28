import type { Metadata } from "next";
import Link from "next/link";
import { Code, Page, Section, Step, Table } from "../ui";

export const metadata: Metadata = {
  title: "Trade through QHooks' MCP",
  description:
    "Add QHooks' MCP server so an agent can trade and sign on its own machine. The link on this page is Autonomo's referral link: what Autonomo earns from it, and what stays the same for the trader.",
};

const QHOOKS = "https://qhooks.com";
const SKILL = `${QHOOKS}/skill.md`;
// Autonomo's partner link. The referral section below says what it earns; keep the two on the same page.
const MCP_URL = `${QHOOKS}/mcp?ref=autonomo`;
const MCP_PLAIN = `${QHOOKS}/mcp`;

const CLAUDE_CODE = `claude mcp add --transport http qhooks "${MCP_URL}"`;

const MCP_JSON = `{
  "mcpServers": {
    "qhooks": { "url": "${MCP_URL}" }
  }
}`;

export default function QHooksMcpGuidePage() {
  return (
    <Page title="Trade through QHooks' MCP">
      <p>
        QHooks: an MCP server for agents that trade. It finds the route and hands back an unsigned transaction, so the
        agent signs on its own machine. Bring traders, get 20% of their fee: agents that pass Autonomo&apos;s wallet as
        the referrer on QHooks trades earn Autonomo 20% of the QHooks fee, and the trader pays the same either way.
      </p>
      <div className="my-6 rounded-lg border border-line bg-surface p-4 text-sm">
        <b>The link on this page is Autonomo&apos;s referral link.</b> Autonomo earns a share of QHooks&apos; fee on
        trades made through it. <a href="#referral">The referral, in plain words</a> has the details, and the address to
        use if you would rather add QHooks without it.
      </div>
      <Table
        rows={[
          ["Made by", <><a href={QHOOKS}>QHooks</a>. Autonomo doesn&apos;t run it</>],
          ["Where it runs", <>QHooks hosts it, so there is nothing to install</>],
          ["Keys", <>None to connect. It returns unsigned transactions, and the agent&apos;s own wallet signs them</>],
          ["What it covers", <>Token info and quotes, spot trades, launches, QProof checks and wallet portfolios</>],
          ["Reference", <><a href={SKILL}>qhooks.com/skill.md</a>, with every tool and option</>],
        ]}
      />

      <Section id="add" title="Add it to your agent">
        <Step n={1} title="Add the server">
          <p>Claude Code:</p>
          <Code code={CLAUDE_CODE} lang="bash" />
          <p>Cursor and other apps that take a remote MCP server:</p>
          <Code code={MCP_JSON} lang="json" />
        </Step>
        <Step n={2} title="Look before you trade">
          <p>
            Reading is free and needs no wallet. For example: <i>&ldquo;What does QHooks say about token 0x…?&rdquo;</i>{" "}
            or <i>&ldquo;Quote a buy of this token for 0.01 ETH.&rdquo;</i>
          </p>
        </Step>
        <Step n={3} title="Sign on your own machine">
          <p>
            When the agent prepares a trade, QHooks returns an unsigned transaction with the quote, the fees and the
            least you would receive. Nothing has happened yet. The trade only goes through when your agent&apos;s own
            wallet signs it and sends it. Read what it shows before you say yes.
          </p>
        </Step>
      </Section>

      <Section id="referral" title="The referral, in plain words">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            The address above ends in <code>?ref=autonomo</code>. QHooks&apos; reference says a partner link supplies that
            partner&apos;s wallet as the referrer when the agent passes none. Here that wallet is Autonomo&apos;s.
          </li>
          <li>
            Autonomo is credited <b>20% of QHooks&apos; fee</b> on spot trades by a trader it referred. On QHooks&apos; own
            QHOOKS/WETH pool on Robinhood Chain it also gets 12.5% of that pool&apos;s hook charges.
          </li>
          <li>
            <b>The trader pays the same either way.</b> The share comes out of QHooks&apos; fee, not on top of it.
          </li>
          <li>
            It sticks. The first referrer a wallet trades with on a chain stays its referrer there. If your wallet
            already has one, this link changes nothing.
          </li>
          <li>Perps, OTC deals and agreements carry no referral share.</li>
        </ul>
        <p>
          To add QHooks without Autonomo&apos;s referral, use <code>{MCP_PLAIN}</code> in the same command.
        </p>
      </Section>

      <Section id="know" title="Good to know">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <b>Autonomo places no trades.</b> Autonomo sells data per call. The trading is between your agent and
            QHooks, and questions about a trade go to QHooks.
          </li>
          <li>
            <b>Trading uses real money and can lose it.</b> Nothing on this page is financial advice. Give an agent a
            wallet that holds only what it may spend.
          </li>
          <li>Only tokens with a pool that QHooks lists can be traded through it.</li>
          <li>
            Before a buy, <Link href="/projects/qproof">QProof</Link> gives the evidence on a token, and Autonomo&apos;s
            own <Link href="/docs/official-apis">Risk Checker</Link> gives a second read from different data.
          </li>
          <li>
            To keep what the agent isn&apos;t spending behind two keys, see{" "}
            <Link href="/docs/qwallet">Keep an agent&apos;s savings in a QWallet</Link>.
          </li>
        </ul>
      </Section>
    </Page>
  );
}
