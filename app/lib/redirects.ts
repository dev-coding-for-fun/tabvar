/**
 * Post-login redirect validation.
 *
 * `redirectTo` accepts same-origin relative paths ("/issues?status=open")
 * and absolute URLs on the primary domain or any of its subdomains
 * ("https://app.tabvar.org/issues"). Absolute URLs must include the
 * `https://` protocol so they are trivially distinguishable from
 * relative paths; anything else is rejected to prevent open redirects.
 */

const PRIMARY_DOMAIN = "tabvar.org";

/**
 * Returns the candidate when it is a safe post-login redirect target,
 * or `null` when it is missing or unsafe.
 *
 * Safe targets are relative paths starting with a single leading slash
 * and `https://` URLs whose hostname is the primary domain or a
 * subdomain of it. The candidate must already be URL-decoded.
 */
export function getSafeRedirectTo(candidate: string | null | undefined): string | null {
  if (!candidate) {
    return null;
  }

  const target = candidate.trim();
  if (!target || /[\r\n]/.test(target)) {
    return null;
  }

  if (/^https:\/\//i.test(target)) {
    let hostname: string;
    try {
      hostname = new URL(target).hostname.toLowerCase();
    } catch {
      return null;
    }
    if (hostname === PRIMARY_DOMAIN || hostname.endsWith(`.${PRIMARY_DOMAIN}`)) {
      return target;
    }
    return null;
  }

  if (target.startsWith("/") && !target.startsWith("//") && !target.startsWith("/\\")) {
    return target;
  }

  return null;
}
