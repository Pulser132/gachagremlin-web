/**
 * Wikitext and index-page parsing.
 *
 * Ported from the bot's `src/gachagremlin/wiki/parser.py` (GachaGremlin
 * repo), which documents the reasoning for each quirk below. Pure functions
 * over strings — no network — so everything here is testable against saved
 * fixtures (tests/fixtures/, copied verbatim from the bot repo).
 */
import { decodeHtmlEntities } from './entities.ts';
import { dayRangeContains } from './times.ts';
import type { ItemPoolSpec } from './games.ts';

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
 *
 * Some listings (HSR) interleave `<th colspan="2">Version X: <range></th>`
 * header rows with the category rows, and Current keeps long-finished
 * versions around. When `dropEndedAsOf` is given, a Current row under a
 * header whose range doesn't contain that day (inclusive) is dropped; a header that doesn't parse
 * (e.g. "Since July 24, 2026 (Indefinite)") keeps its rows. Upcoming is
 * never filtered.
 */
export function parseBannerIndex(pageHtml: string, dropEndedAsOf?: Date): BannerIndexSections {
  const heads = collectHeadingPositions(pageHtml);

  function categories(idPrefix: string, dropEnded: boolean): BannerListingCategory[] {
    const segment = sliceSection(pageHtml, heads, (id) => id.startsWith(idPrefix));
    const out: BannerListingCategory[] = [];
    const versionHeaders = [...segment.matchAll(/<th colspan="2">([\s\S]*?)<\/th>/g)].map((h) => ({
      pos: h.index,
      // "Version 4.6: <range>" -> "<range>"; header text without a colon stays whole.
      range: decodeHtmlEntities(h[1].replace(/<[^>]*>/g, '')).replace(/^[^:]*:/, ''),
    }));
    const rowRe = /<tr>\s*<td>\s*<a[^>]*\btitle="([^"]+)"[^>]*>[\s\S]*?<\/a>\s*<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g;
    for (const rowMatch of segment.matchAll(rowRe)) {
      if (dropEnded && dropEndedAsOf) {
        const header = versionHeaders.findLast((h) => h.pos < rowMatch.index);
        if (header && dayRangeContains(header.range, dropEndedAsOf) === false) continue;
      }
      const label = decodeHtmlEntities(rowMatch[1]);
      const cell = rowMatch[2];
      // Each Banner block links its icon and its name to the same dated
      // page, so anchors are de-duped by title. Not-yet-uploaded art renders
      // as a broken-file anchor (title "File:...", no <img>) and is skipped;
      // the Banner still appears via its name link, just with no thumbnail.
      const entryRe = /<a[^>]*\bhref="\/wiki\/[^"]*"[^>]*\btitle="([^"]+)"[^>]*>(<img([^>]*)>)?/g;
      const byTitle = new Map<string, BannerListingEntry>();
      for (const entryMatch of cell.matchAll(entryRe)) {
        const title = decodeHtmlEntities(entryMatch[1]);
        if (/^(File|Special):/.test(title)) continue;
        const imgAttrs = entryMatch[3] ?? '';
        // Whole-page fetches lazyload these thumbnails: `src` holds a
        // placeholder data: URI and the real CDN url is in `data-src`.
        // Section-scoped fetches skip lazyload and put it straight in `src`.
        // Prefer data-src; fall back to src only when it isn't a data: URI.
        const dataSrc = /\bdata-src="([^"]+)"/.exec(imgAttrs)?.[1];
        const src = /\bsrc="([^"]+)"/.exec(imgAttrs)?.[1];
        const rawThumb = dataSrc ?? (src && !src.startsWith('data:') ? src : null);
        const thumbUrl = rawThumb ? decodeHtmlEntities(rawThumb) : null;
        const existing = byTitle.get(title);
        if (!existing) byTitle.set(title, { title, thumbUrl });
        else if (!existing.thumbUrl && thumbUrl) existing.thumbUrl = thumbUrl;
      }
      const banners = [...byTitle.values()];
      if (banners.length > 0) out.push({ label, banners });
    }
    return out;
  }

  return { current: categories('Current', true), upcoming: categories('Upcoming', false) };
}

/**
 * Extract one channel page's Banners from ZZZ's rendered `Current & Upcoming
 * Signal Searches` section (`'channelPages'` listing shape).
 *
 * The section is a flat sequence of divs, not a table: a `<b>Current Event
 * Run</b>` label, then one `Main article: <a title="<dated page title>">`
 * block per concurrent Banner, then (after an `<hr/>`) the `Upcoming Event
 * Run` label and its blocks. Anchored on the two run labels rather than the
 * `<hr/>` so the split doesn't depend on how a single concurrent Banner
 * renders. The adjacent countdown blocks are ignored — times come from the
 * per-Banner infobox — and the listing embeds no image, so `thumbUrl` is
 * always null. The category label is the page title (`categoryLabel`).
 */
export function parseChannelPage(pageHtml: string, categoryLabel: string): BannerIndexSections {
  const heads = collectHeadingPositions(pageHtml);
  // The heading id carries a literal `&` (HTML-escaped in the attribute).
  const segment = sliceSection(pageHtml, heads, (id) => /^Current_(?:&amp;|&|\.26)_Upcoming/.test(id));
  const labelRe = /<b>\s*(Current|Upcoming) Event Run\s*<\/b>/g;
  const labels = [...segment.matchAll(labelRe)];

  function run(kind: 'Current' | 'Upcoming'): BannerListingCategory[] {
    const banners: BannerListingEntry[] = [];
    labels.forEach((m, i) => {
      if (m[1] !== kind) return;
      const body = segment.slice(m.index + m[0].length, i + 1 < labels.length ? labels[i + 1].index : segment.length);
      for (const link of body.matchAll(/Main article:\s*<a[^>]*\btitle="([^"]+)"/g)) {
        const title = decodeHtmlEntities(link[1]);
        if (!banners.some((b) => b.title === title)) banners.push({ title, thumbUrl: null });
      }
    });
    return banners.length > 0 ? [{ label: categoryLabel, banners }] : [];
  }

  return { current: run('Current'), upcoming: run('Upcoming') };
}

/**
 * Scan a `{{TemplateName|...}}` invocation's `|field = value` lines into a
 * flat map, starting right after `headerRe`'s match. Shared by `parseInfobox`
 * (Event/Wish infoboxes) and `parseItemPool` (the item-pool template) — the field-scanning
 * logic below the template header is identical between them; only the
 * header pattern differs.
 */
function parseTemplateFields(wikitext: string, headerRe: RegExp): Record<string, string> {
  const m = headerRe.exec(wikitext);
  if (!m) return {};
  const fields: Record<string, string> = {};
  const lineRe = /^\s*\|\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/;
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
 * Parse a Banner's item-pool template (`spec.templateName`, e.g.
 * `{{Wish Pool|...}}`). The Featured fields named by `spec` are what the
 * cards render; standard-pool fields are ignored here — parsed by nobody,
 * since they're identical across every Banner in a group (see the issue's
 * Out of Scope section). Top tier maps to `featured5Star` and second tier to
 * `featured4Star` positionally, whatever the game's own rarity names are.
 */
export function parseItemPool(
  wikitext: string,
  spec: ItemPoolSpec,
): { featured5Star: string[]; featured4Star: string[] } {
  const headerRe = new RegExp(`\\{\\{${escapeRegExp(spec.templateName)}[ \\t]*(?:\\n|\\|)`);
  const fields = parseTemplateFields(wikitext, headerRe);
  const collect = (names: string[]): string[] =>
    names.flatMap((name) =>
      (fields[name] ?? '')
        .split(';')
        .map((x) => x.trim())
        .filter(Boolean),
    );
  return {
    featured5Star: collect(spec.topTierFeatured),
    featured4Star: collect(spec.secondTierFeatured),
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
