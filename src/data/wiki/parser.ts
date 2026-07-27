/**
 * Wikitext and index-page parsing.
 *
 * Ported from the bot's `src/gachagremlin/wiki/parser.py` (GachaGremlin
 * repo), which documents the reasoning for each quirk below. Pure functions
 * over strings — no network — so everything here is testable against saved
 * fixtures (tests/fixtures/, copied verbatim from the bot repo).
 */
import { decodeHtmlEntities } from './entities.ts';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize CRLF/CR to LF. The MediaWiki API returns LF, but content that
 * has round-tripped through a Windows text-mode file write (e.g. the copied
 * test fixtures) can carry CRLF, which breaks the `\n`-anchored regexes
 * below. Called once at each ingestion boundary rather than scattering
 * `\r?\n` through every pattern.
 */
export function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Best-effort wikitext -> plain text for a single value or bullet line. */
export function clean(s: string): string {
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1'); // [[A|B]] -> B
  s = s.replace(/\[\[([^\]]*)\]\]/g, '$1'); // [[A]] -> A
  s = s.replace(/\{\{LL\|([^|}]*)[^}]*\}\}/g, '$1'); // {{LL|X|.}} -> X
  s = s.replace(/\{\{[^}]*\}\}/g, ''); // drop other templates
  s = s.replace(/'''?/g, ''); // bold/italic
  s = s.replace(/<[^>]+>/g, ''); // stray html
  return decodeHtmlEntities(s).trim();
}

export interface IndexSections {
  current: string[];
  upcoming: string[];
}

interface HeadingPosition {
  pos: number;
  id: string;
}

/** Collects `<h1-6 id="...">` / `class="mw-headline" id="...">` heading
 * positions in document order — the shared preamble `parseIndex` and
 * `parseBannerIndex` both slice a page into sections by. */
function collectHeadingPositions(pageHtml: string): HeadingPosition[] {
  const heads: HeadingPosition[] = [];
  for (const m of pageHtml.matchAll(/<h[1-6][^>]*\bid="([^"]+)"/g)) {
    heads.push({ pos: m.index, id: m[1] });
  }
  for (const m of pageHtml.matchAll(/class="mw-headline"[^>]*\bid="([^"]+)"/g)) {
    heads.push({ pos: m.index, id: m[1] });
  }
  heads.sort((a, b) => a.pos - b.pos);
  return heads;
}

/** The HTML between the first heading `matchId` accepts and the next heading
 * (or end of page). Empty string when no heading matches. */
function sliceSection(pageHtml: string, heads: HeadingPosition[], matchId: (id: string) => boolean): string {
  const i = heads.findIndex((h) => matchId(h.id));
  if (i === -1) return '';
  const p0 = heads[i].pos;
  const p1 = i + 1 < heads.length ? heads[i + 1].pos : pageHtml.length;
  return pageHtml.slice(p0, p1);
}

/**
 * Extract event page titles from the rendered Event index page.
 *
 * Section headings carry ids ("Current", "Upcoming"); event links between a
 * heading and the next one belong to that section. Each event is linked
 * twice (icon + text), hence the de-dup.
 */
export function parseIndex(pageHtml: string): IndexSections {
  const heads = collectHeadingPositions(pageHtml);

  function section(name: string): string[] {
    const seg = sliceSection(pageHtml, heads, (id) => id === name);
    const out: string[] = [];
    for (const m of seg.matchAll(/<a [^>]*title="([^"]+)"/g)) {
      const x = decodeHtmlEntities(m[1]);
      const prefix = x.split(':')[0];
      if (['File', 'Category', 'Special', 'Help', 'Template'].includes(prefix)) continue;
      if (x.startsWith('Sign in') || x === 'Event/History' || x === 'Events/History') continue;
      if (!out.includes(x)) out.push(x);
    }
    return out;
  }

  return { current: section('Current'), upcoming: section('Upcoming') };
}

export interface BannerListingEntry {
  /** The dated per-Banner page title (e.g. "Somnias a Luna/2026-07-21") —
   * what a detail fetch is made against. */
  title: string;
  /** The listing's own already-resolved CDN thumbnail, kept as a fallback
   * for when the detail page's own image resolution fails. Null if the
   * listing's `<img>` couldn't be read (e.g. no src/data-src attribute). */
  thumbUrl: string | null;
}

export interface BannerListingCategory {
  /** The category row's link title (e.g. "Character Event Wish") — matched
   * against a `BannerGroup` label by the caller (see ADR-0003). */
  label: string;
  banners: BannerListingEntry[];
}

export interface BannerIndexSections {
  current: BannerListingCategory[];
  upcoming: BannerListingCategory[];
}

/**
 * Extract Banner-category rows from the rendered Banner listing page (e.g.
 * Genshin's `Wish`).
 *
 * The page is a table per Current/Upcoming section: one row per category,
 * its first cell a link to the category page (whose `title` attribute is
 * the category's full display label), its second cell a `<div>` per Banner
 * carrying a link (icon + text, both to the same dated page) and an image.
 * A different enough shape from the Event index's heading-anchored link
 * list (`parseIndex`) that a new function serves it better than stretching
 * that one to cover both (see ADR-0002).
 *
 * Slices by heading id exactly like `parseIndex` does, rather than an extra
 * `prop=sections` round-trip to resolve a section number first.
 */
export function parseBannerIndex(pageHtml: string): BannerIndexSections {
  const heads = collectHeadingPositions(pageHtml);

  function categories(idPrefix: string): BannerListingCategory[] {
    const segment = sliceSection(pageHtml, heads, (id) => id.startsWith(idPrefix));
    const out: BannerListingCategory[] = [];
    const rowRe = /<tr>\s*<td>\s*<a[^>]*\btitle="([^"]+)"[^>]*>[\s\S]*?<\/a>\s*<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g;
    for (const rowMatch of segment.matchAll(rowRe)) {
      const label = decodeHtmlEntities(rowMatch[1]);
      const cell = rowMatch[2];
      const banners: BannerListingEntry[] = [];
      // Each Banner block links its icon and its name to the same dated
      // page; matching the icon-wrapping anchor (href immediately followed
      // by title, then <img>) naturally captures one entry per Banner
      // without a second pass to de-dup the repeated text link.
      const entryRe = /<a[^>]*\bhref="[^"]*"[^>]*\btitle="([^"]+)"[^>]*><img([^>]*)>/g;
      for (const entryMatch of cell.matchAll(entryRe)) {
        const title = decodeHtmlEntities(entryMatch[1]);
        const imgAttrs = entryMatch[2];
        // Whole-page fetches lazyload these thumbnails: `src` holds a
        // placeholder data: URI and the real CDN url is in `data-src`.
        // Section-scoped fetches skip lazyload and put it straight in `src`.
        // Prefer data-src; fall back to src only when it isn't a data: URI.
        const dataSrc = /\bdata-src="([^"]+)"/.exec(imgAttrs)?.[1];
        const src = /\bsrc="([^"]+)"/.exec(imgAttrs)?.[1];
        const thumbUrl = dataSrc ?? (src && !src.startsWith('data:') ? src : null);
        banners.push({ title, thumbUrl: thumbUrl ? decodeHtmlEntities(thumbUrl) : null });
      }
      if (banners.length > 0) out.push({ label, banners });
    }
    return out;
  }

  return { current: categories('Current'), upcoming: categories('Upcoming') };
}

/**
 * Scan a `{{TemplateName|...}}` invocation's `|field = value` lines into a
 * flat map, starting right after `headerRe`'s match. Shared by `parseInfobox`
 * (Event/Wish infoboxes) and `parseItemPool` (Wish Pool) — the field-scanning
 * logic below the template header is identical between them; only the
 * header pattern differs.
 */
function parseTemplateFields(wikitext: string, headerRe: RegExp): Record<string, string> {
  const m = headerRe.exec(wikitext);
  if (!m) return {};
  const fields: Record<string, string> = {};
  const lineRe = /^\s*\|\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/;
  const rest = wikitext.slice(m.index + m[0].length);
  for (const line of rest.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('}}')) break;
    if (trimmed.startsWith('<!--')) continue;
    const lm = lineRe.exec(line);
    if (lm) fields[lm[1]] = lm[2];
  }
  return fields;
}

/**
 * Parse an infobox template's fields, matching one of `templateNames`
 * exactly (default: "Event" or "Event Infobox" — ZZZ uses the latter)
 * followed by a newline or pipe, so "{{Event Tabs}}", "{{Event Details}}"
 * etc. are not mistaken for it. Pass `['Wish']` for a Banner's `{{Wish|...}}`
 * infobox — the field-extraction logic is identical, only the template name
 * differs.
 */
export function parseInfobox(
  wikitext: string,
  templateNames: string[] = ['Event', 'Event Infobox'],
): Record<string, string> {
  const alternatives = templateNames.map(escapeRegExp).join('|');
  const headerRe = new RegExp(`\\{\\{(?:${alternatives})[ \\t]*(?:\\n|\\|)`);
  return parseTemplateFields(wikitext, headerRe);
}

/**
 * Parse a Banner's `{{Wish Pool|...}}` item-pool template. Featured fields
 * (`character_5_F`/`character_4_F` for character Banners,
 * `weapon_5_F`/`weapon_4_F` for weapon Banners) are what the cards render;
 * standard-pool fields are ignored here — parsed by nobody in v1, since
 * they're identical across every Banner in a group (see the issue's Out of
 * Scope section).
 */
export function parseItemPool(wikitext: string): { featured5Star: string[]; featured4Star: string[] } {
  const headerRe = /\{\{Wish Pool[ \t]*(?:\n|\|)/;
  const fields = parseTemplateFields(wikitext, headerRe);
  const splitList = (s: string | undefined): string[] =>
    (s ?? '')
      .split(';')
      .map((x) => x.trim())
      .filter(Boolean);
  return {
    featured5Star: [...splitList(fields.character_5_F), ...splitList(fields.weapon_5_F)],
    featured4Star: [...splitList(fields.character_4_F), ...splitList(fields.weapon_4_F)],
  };
}

/** Bullet lines under a ==Header== section, cleaned to plain text. */
export function sectionBullets(wikitext: string, header: string): string[] {
  const headerRe = new RegExp('={2,}\\s*' + escapeRegExp(header) + '\\s*={2,}');
  const m = headerRe.exec(wikitext);
  if (!m) return [];
  const tail = wikitext.slice(m.index + m[0].length);
  const endMatch = /\n={2,}[^=]/.exec(tail);
  const body = endMatch ? tail.slice(0, endMatch.index) : tail;
  const bullets: string[] = [];
  for (const bm of body.matchAll(/^\*+\s*(.+)$/gm)) {
    const cleaned = clean(bm[1]);
    if (cleaned) bullets.push(cleaned);
  }
  return bullets;
}

export function getDescription(wikitext: string, fields: Record<string, string>): string {
  if (fields.description) {
    return clean(fields.description);
  }
  // Strip comments first (commented-out {{Description}} blocks must not
  // match) and allow one level of nested templates like {{LL|…}} inside the
  // value.
  const text = wikitext.replace(/<!--[\s\S]*?-->/g, '');
  const m = /\{\{Description\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}/.exec(text);
  return m ? clean(m[1]) : '';
}

const DATE_SUFFIX_RE = /[ /]\d{4}-\d{1,2}-\d{1,2}$/;

/** Display name: strip rerun date suffixes; fall back to the page title. */
export function cleanEventName(rawName: string, title: string): string {
  let name = clean(rawName).replace(DATE_SUFFIX_RE, '');
  if (!name) {
    // some pages have an empty or template-only name field
    name = clean(title).replace(DATE_SUFFIX_RE, '');
  }
  return name;
}
