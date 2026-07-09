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

/**
 * Extract event page titles from the rendered Event index page.
 *
 * Section headings carry ids ("Current", "Upcoming"); event links between a
 * heading and the next one belong to that section. Each event is linked
 * twice (icon + text), hence the de-dup.
 */
export function parseIndex(pageHtml: string): IndexSections {
  const heads: { pos: number; id: string }[] = [];
  for (const m of pageHtml.matchAll(/<h[1-6][^>]*\bid="([^"]+)"/g)) {
    heads.push({ pos: m.index, id: m[1] });
  }
  for (const m of pageHtml.matchAll(/class="mw-headline"[^>]*\bid="([^"]+)"/g)) {
    heads.push({ pos: m.index, id: m[1] });
  }
  heads.sort((a, b) => a.pos - b.pos);

  function section(name: string): string[] {
    const i = heads.findIndex((h) => h.id === name);
    if (i === -1) return [];
    const p0 = heads[i].pos;
    const p1 = i + 1 < heads.length ? heads[i + 1].pos : pageHtml.length;
    const seg = pageHtml.slice(p0, p1);
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

/**
 * Parse the event infobox template's fields.
 *
 * Matches the template name exactly ("Event" or "Event Infobox" — ZZZ uses
 * the latter) followed by a newline or pipe, so "{{Event Tabs}}",
 * "{{Event Details}}" etc. are not mistaken for it.
 */
export function parseInfobox(wikitext: string): Record<string, string> {
  const m = /\{\{Event(?: Infobox)?[ \t]*(?:\n|\|)/.exec(wikitext);
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
