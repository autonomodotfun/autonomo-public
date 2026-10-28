// HTTP basic auth for /admin. Any username; the password must equal ADMIN_PASSWORD.
export function isAuthorized(authorization: string | null): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !authorization?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(authorization.slice(6));
  } catch {
    return false;
  }
  const password = decoded.slice(decoded.indexOf(":") + 1);
  return timingSafeEqual(password, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
