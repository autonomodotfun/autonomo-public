import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { Code, Page, Section, Step, Table } from "../ui";

export const metadata: Metadata = {
  title: "Keep an agent's savings in a QWallet",
  description: `Keep an agent's savings in a QHooks QWallet on ${TOKEN.chainName}, where every withdrawal needs two keys, and pay for Autonomo APIs from a small wallet that you top up from it.`,
};

const QHOOKS = "https://qhooks.com";
const SKILL = `${QHOOKS}/skill.md`;
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

const CONFIG = `{
  "mcpServers": {
    "qhooks": {
      "command": "npx",
      "args": ["-y", "@qhooks/mcp"],
      "env": {
        "QHOOKS_KEYFILE": "/absolute/path/to/owner-key",
        "QHOOKS_QWALLET_PASSPHRASE_FILE": "/absolute/path/to/passphrase"
      }
    }
  }
}`;

const CLAUDE_CODE = "claude mcp add qhooks -e QHOOKS_KEYFILE=/absolute/path/to/owner-key -e QHOOKS_QWALLET_PASSPHRASE_FILE=/absolute/path/to/passphrase -- npx -y @qhooks/mcp";

const CREATE_KEY = `qwallet_key {"action": "create"}`;

const SETUP = `prepare_qwallet_setup {"chain": "4663", "owner": "<owner wallet>"}
qhooks_sign_and_send {"chain": "4663", "transactions": [<the verifier creation>], "confirm": true}

prepare_qwallet_setup {"chain": "4663", "owner": "<owner wallet>", "verifier": "<verifier address>"}
qhooks_sign_and_send {"chain": "4663", "transactions": [<the pool creation>], "confirm": true}`;

const ENROLL = `prepare_qwallet_setup {"chain": "4663", "owner": "<owner wallet>", "verifier": "<verifier>",
                       "pool": "<pool>", "publicKey": "<from qwallet_key>", "tokens": [<from setup>]}
qwallet_approve {"chain": "4663", "approval": <the approval it returned>}
qhooks_sign_and_send {"chain": "4663", "transactions": [<the transaction qwallet_approve returned>], "confirm": true}`;

const DEPOSIT = `prepare_qwallet_deposit {"chain": "4663", "owner": "<owner wallet>", "verifier": "<verifier>", "pool": "<pool>",
                         "publicKey": "<public key>", "tokens": [<from setup>],
                         "asset": "${USDG}", "amount": "5000000"}
qhooks_sign_and_send {"chain": "4663", "transactions": [<the approval>, <the deposit>], "confirm": true}`;

const WITHDRAW = `prepare_qwallet_withdraw {"chain": "4663", "owner": "<owner wallet>", "verifier": "<verifier>", "pool": "<pool>",
                          "publicKey": "<public key>", "tokens": [<from setup>],
                          "asset": "${USDG}", "amount": "1000000", "recipient": "<the paying wallet>"}
qwallet_approve {"chain": "4663", "approval": <the approval it returned>}
qhooks_sign_and_send {"chain": "4663", "transactions": [<the transaction qwallet_approve returned>], "confirm": true}`;

const STATUS = `qwallet_status {"chain": "4663", "owner": "<owner wallet>", "verifier": "<verifier>", "pool": "<pool>",
                "publicKey": "<public key>", "tokens": [<from setup>]}`;

export default function QWalletGuidePage() {
  return (
    <Page title="Keep an agent's savings in a QWallet">
      <p>
        An agent that pays for APIs needs a wallet it can sign with, and a key that signs on its own can be stolen.
        Splitting the money in two keeps that risk small. The agent&apos;s savings sit in a <b>QWallet</b>, where every
        withdrawal needs two keys. A <b>small wallet</b> pays for Autonomo APIs day to day, and you top it up from the
        QWallet when it runs low.
      </p>
      <p>
        QWallets are built by <a href={QHOOKS}>QHooks</a>. This guide follows their reference,{" "}
        <a href={SKILL}>qhooks.com/skill.md</a>, which has every tool and option.
      </p>
      <div className="my-6 rounded-lg border border-line bg-surface p-4 text-sm">
        <b>The independent review of the QWallet contracts is still pending, so start with small amounts.</b> QHooks
        tested the contracts end to end on a private chain: deploying, enrolling a key, depositing, withdrawing and
        refusing tampered approvals.
      </div>
      <Table
        rows={[
          ["Chain", <>{TOKEN.chainName}. The tokens a QWallet holds are fixed when it&apos;s created: USDG by default, and ETH always</>],
          ["You need", "Two wallets: an owner wallet for the QWallet and a small wallet that pays, plus a little ETH for gas"],
          ["Tools", <>QHooks&apos; MCP server, <code>@qhooks/mcp</code> 0.2.0 or later (Node 18+), which signs on your machine</>],
          ["Cost", "No QHooks fee. You pay network gas"],
        ]}
      />

      <Section id="how-it-works" title="How it works">
        <Table
          rows={[
            [
              <b key="q">QWallet</b>,
              "A contract that only you control, holding the savings. A withdrawal needs the owner wallet's signature and the post-quantum key's signature, both for the same amount, recipient and 15-minute window. QHooks holds neither key and can't move the funds",
            ],
            [<b key="o">Owner wallet</b>, "Creates the QWallet, deposits into it and signs withdrawals. It needs a little ETH for gas"],
            [
              <b key="p">Post-quantum key</b>,
              "A post-quantum signature key (SLH-DSA, a NIST standard), a different kind of key from a wallet key. The agent creates it on its own machine",
            ],
            [
              <b key="h">Paying wallet</b>,
              <>
                The small wallet the agent pays Autonomo APIs from, set as <code>AUTONOMO_WALLET_KEY</code>. Keep about a
                day&apos;s spending in it
              </>,
            ],
          ]}
        />
        <p>
          x402 payments are signed by a plain wallet, so an agent can&apos;t pay an API straight from the QWallet. It
          withdraws to the paying wallet first, then pays from there. Use a different wallet as the owner and as the
          paying wallet: then the paying wallet&apos;s key can only ever lose what&apos;s in the paying wallet.
        </p>
      </Section>

      <Section id="set-up" title="Set up the QWallet">
        <Step n={1} title="Add QHooks' MCP server with a key and a passphrase">
          <p>
            The server reads and prepares on its own, and signs only with a key on your machine. Give it the owner
            wallet&apos;s key as a file, and a passphrase file for the post-quantum key, at least 16 bytes long. Both files
            must have mode <code>600</code> (only you can read them). In Claude Desktop, Cursor and other MCP clients:
          </p>
          <Code code={CONFIG} lang="JSON" />
          <p>In Claude Code, the two settings go in the command that adds the server:</p>
          <Code code={CLAUDE_CODE} lang="bash" />
          <p>
            Restart the client. <code>qhooks_status</code> then shows the owner wallet&apos;s address and that QWallet
            tools are on.
          </p>
        </Step>
        <Step n={2} title="Create the post-quantum key">
          <Code code={CREATE_KEY} lang="MCP tool" />
          <p>
            It writes the key to a file, encrypted with your passphrase, by default in <code>~/.qhooks-mcp</code>. That
            file is the backup: copy it somewhere safe, and keep the passphrase too. With both, the key can be restored on{" "}
            <a href={`${QHOOKS}/qwallets`}>qhooks.com/qwallets</a>. Lose either one and the savings can&apos;t be
            withdrawn.
          </p>
        </Step>
        <Step n={3} title="Create the QWallet">
          <p>
            Two contracts, each prepared and then sent from the owner wallet: a verifier, then the pool that holds the
            funds. The pool holds USDG unless you pass another token list, and ETH is always accepted. Keep the addresses
            and the token list that come back, and pass that list on every later call: the pool&apos;s code is checked
            against it each time.
          </p>
          <Code code={SETUP} lang="MCP tools" />
        </Step>
        <Step n={4} title="Enroll the post-quantum key">
          <p>
            <code>qwallet_approve</code> checks the prepared action against your request and the pool&apos;s code on
            chain, then signs it with both keys, locally.
          </p>
          <Code code={ENROLL} lang="MCP tools" />
        </Step>
        <Step n={5} title="Deposit the savings">
          <p>
            From the owner wallet. Amounts are in USDG&apos;s smallest unit, so <code>5000000</code> is 5 USDG. A deposit
            needs only the owner wallet: a token approval for the exact amount, then the deposit.
          </p>
          <Code code={DEPOSIT} lang="MCP tools" />
          <p>
            To keep ETH in it too, use <code>&quot;asset&quot;: &quot;ETH&quot;</code> and an amount in wei. Then check
            with <code>qwallet_status</code>. Its <code>next</code> field goes through <code>deploy_verifier</code>,{" "}
            <code>deploy_pool</code>, <code>create_pq_key</code>, <code>enroll</code> and <code>deposit</code>, and says{" "}
            <code>ready</code> once the savings are in.
          </p>
          <Code code={STATUS} lang="MCP tool" />
        </Step>
      </Section>

      <Section id="pay" title="Pay from the small wallet">
        <p>
          The paying wallet is the one you give Autonomo&apos;s tools, as <code>AUTONOMO_WALLET_KEY</code>: in the{" "}
          <Link href="/docs/agents#mcp">MCP server</Link>, the <Link href="/docs/sdk">SDK</Link>, the{" "}
          <Link href="/docs/langchain">LangChain tools</Link> or the <Link href="/docs/eliza">elizaOS plugin</Link>. Set its
          daily budget to about what it holds, so the two limits match.
        </p>
      </Section>

      <Section id="top-up" title="Top up the paying wallet">
        <p>
          When the paying wallet runs low, Autonomo refuses the next call before anything is signed and says the wallet
          doesn&apos;t have enough USDG. Withdraw from the QWallet to the paying wallet, then call again:
        </p>
        <Code code={WITHDRAW} lang="MCP tools" />
        <p>
          The approval is for that amount, to that wallet, and is valid for 15 minutes. A changed recipient or a reused
          approval is refused on chain. Withdraw about a day&apos;s spending at a time, so the paying wallet never holds
          much.
        </p>
      </Section>

      <Section title="Good to know">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Start with small amounts.</b> The independent review of the QWallet contracts is still pending.
          </li>
          <li>
            <b>Keep the encrypted key file and the passphrase.</b> The passphrase file must be at least 16 bytes and mode{" "}
            <code>600</code>. The key file plus the passphrase is the only way to recover the post-quantum key: losing
            either means the savings can&apos;t be withdrawn.
          </li>
          <li>
            Both keys sit with the agent, on its machine. A QWallet protects the savings from one leaked key, not from
            someone who takes over the whole machine, so keep the key files and the passphrase locked down.
          </li>
          <li>
            The tools above work on {TOKEN.chainName}. For other chains, QHooks has the same QWallet in the browser at{" "}
            <a href={`${QHOOKS}/qwallets`}>qhooks.com/qwallets</a>.
          </li>
          <li>
            QHooks&apos; MCP server signs only what it prepared itself in the last 10 minutes, after checking the chain,
            the destination and a simulation. Its full reference, with the guards on each step, is in{" "}
            <a href={SKILL}>qhooks.com/skill.md</a>.
          </li>
          <li>
            QWallet is QHooks&apos; product, not Autonomo&apos;s. Autonomo doesn&apos;t hold or move the funds, and this
            guide isn&apos;t a review of the contracts. QHooks is an Autonomo <Link href="/partners">partner</Link>.
          </li>
        </ul>
      </Section>
    </Page>
  );
}
