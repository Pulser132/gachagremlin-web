/**
 * MediaWiki Action API client.
 *
 * Anonymous cross-origin requests need `origin=*` in the query string, which
 * makes the Fandom wikis send `Access-Control-Allow-Origin: *` (verified
 * 2026-07-06, see goal.md). No API key needed; the wikis are public.
 *
 * A `userAgent` may be passed for non-browser callers (scripts/smoke.ts runs
 * under Node, where Fandom's bot-UA blocking still applies); browsers can't
 * set this header and don't need to.
 */

export class WikiError extends Error {}

export async function api(
  host: string,
  params: Record<string, string | number>,
  userAgent?: string,
): Promise<any> {
  const search = new URLSearchParams({
    format: 'json',
    formatversion: '2',
    origin: '*',
  });
  for (const [key, value] of Object.entries(params)) {
    search.set(key, String(value));
  }
  const url = `https://${host}/api.php?${search.toString()}`;
  const init: RequestInit | undefined = userAgent ? { headers: { 'User-Agent': userAgent } } : undefined;

  let lastError: unknown;
  for (const attempt of [1, 2]) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      lastError = e;
      if (attempt === 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // one retry smooths transient failures
      }
    }
  }
  throw new WikiError(`API request to ${host} failed: ${String(lastError)}`);
}

/**
 * Resolve an infobox `image` field (a bare filename, e.g. "Foo Event.png")
 * to an actual thumbnail URL via the MediaWiki imageinfo API. Returns null
 * rather than throwing on any failure — a missing banner is a cosmetic gap,
 * not a reason to fail the whole event.
 */
export async function resolveImageUrl(
  host: string,
  filename: string,
  width: number,
  userAgent?: string,
): Promise<string | null> {
  try {
    const data = await api(
      host,
      { action: 'query', titles: `File:${filename}`, prop: 'imageinfo', iiprop: 'url', iiurlwidth: width },
      userAgent,
    );
    const pages = data.query?.pages ?? [];
    const info = pages[0]?.imageinfo?.[0];
    return info?.thumburl ?? info?.url ?? null;
  } catch {
    return null;
  }
}
