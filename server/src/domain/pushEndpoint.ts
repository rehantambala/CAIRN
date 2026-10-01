/**
 * A push subscription's endpoint is a URL the server will later POST to, so it is an SSRF vector if accepted blindly.
 * Only HTTPS endpoints on the browsers' own push services are accepted: Chrome/Edge/Opera/Brave (FCM), Firefox
 * (Mozilla autopush), Edge on Windows (WNS) and Safari (Apple). Anything else — localhost, private ranges, cloud
 * metadata addresses, arbitrary hosts, other ports — is refused.
 */
const HOSTS: RegExp[] = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
];

export function isAllowedPushEndpoint(raw: string): boolean {
  if (raw.length > 1000) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  return HOSTS.some((re) => re.test(u.hostname.toLowerCase()));
}

/** p256dh is an uncompressed P-256 public key (65 bytes), auth a 16-byte secret; both base64url. */
export const PUSH_KEY_RE = { p256dh: /^[A-Za-z0-9_-]{80,100}={0,2}$/, auth: /^[A-Za-z0-9_-]{16,32}={0,2}$/ };
