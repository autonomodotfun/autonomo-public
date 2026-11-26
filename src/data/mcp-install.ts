// The one-click link that adds the MCP server to Cursor.
//
// Format, from Cursor's docs (cursor.com/docs/context/mcp/install-links): the server's entry from mcp.json, as JSON,
// base64 encoded, in `config`, with the server's name in `name`.
//
// No wallet key goes in the link. The server starts without one, and its free tools work. The user adds the key
// afterwards, on their own computer.

export const MCP_SERVER_NAME = "autonomo";

/** What Cursor writes into its mcp.json under the server's name. */
export const MCP_SERVER_ENTRY = { command: "npx", args: ["-y", "autonomo-mcp"] };

const query = () =>
  `name=${MCP_SERVER_NAME}&config=${Buffer.from(JSON.stringify(MCP_SERVER_ENTRY)).toString("base64")}`;

/** Opens Cursor directly. For pages we serve ourselves. */
export const cursorDeeplink = () => `cursor://anysphere.cursor-deeplink/mcp/install?${query()}`;

/** The same through cursor.com, for places that drop links that aren't web links (the README on GitHub and npm). */
export const cursorWebLink = () => `https://cursor.com/install-mcp?${query()}`;
