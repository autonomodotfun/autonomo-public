// Privy's provider throws on an app id that isn't 25 characters, which would take the whole dashboard down.
// Treat a malformed id as "Privy off" so the dashboard falls back to Sign-In with Ethereum instead.
const raw = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
export const privyAppId = raw && raw.length === 25 ? raw : null;
