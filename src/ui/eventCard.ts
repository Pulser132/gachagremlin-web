import type { EventInfo, Region, RegionUnix } from '../types.ts';
import { formatAbsolute } from './format.ts';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  return node;
}

/** Pick the instant for `region`, falling back to Asia (HSR/ZZZ have no SAR
 * entry, so selecting SAR there falls back correctly), then any value. */
export function resolveRegionUnix(unix: RegionUnix | null, region: Region): number | null {
  if (!unix) return null;
  return unix[region] ?? unix.Asia ?? (Object.values(unix)[0] as number | undefined) ?? null;
}

function renderTimes(ev: EventInfo, region: Region): HTMLElement {
  const wrap = el('div', { className: 'event-times' });

  if (ev.status === 'unknown' || !ev.endUnix) {
    wrap.appendChild(el('p', { className: 'event-times-missing', text: 'Times not announced on the wiki yet.' }));
    return wrap;
  }

  const endAt = resolveRegionUnix(ev.endUnix, region);
  const startAt = resolveRegionUnix(ev.startUnix, region);

  if (startAt !== null && ev.status === 'upcoming') {
    wrap.appendChild(renderTimeRow('starts in', startAt));
  }

  if (endAt !== null) {
    wrap.appendChild(renderTimeRow('ends in', endAt));
    if (ev.globalTime) {
      wrap.appendChild(el('p', { className: 'event-time-note', text: 'One global time — same for every server.' }));
    }
  } else {
    wrap.appendChild(el('p', { className: 'event-times-missing', text: 'End time not listed on the wiki.' }));
  }

  return wrap;
}

function renderTimeRow(label: string, unixSeconds: number): HTMLElement {
  const row = el('p', { className: 'event-time-row' });
  const countdown = el('span', { className: 'countdown' });
  countdown.dataset.deadline = String(unixSeconds);
  countdown.dataset.countdownLabel = label;
  row.appendChild(countdown);
  row.appendChild(el('span', { className: 'event-time-absolute', text: ` (${formatAbsolute(unixSeconds)})` }));
  return row;
}

export function renderEventCard(ev: EventInfo, region: Region): HTMLElement {
  const card = el('article', { className: `event-card game-${ev.game} status-${ev.status}` });

  if (ev.imageUrl) {
    const banner = el('img', { className: 'event-banner' });
    banner.alt = '';
    // Purely decorative alongside the name heading right below it — an
    // empty alt keeps screen readers from reading redundant/opaque filenames.
    // Fandom's image CDN hotlink-blocks any request whose Referer isn't a
    // fandom.com page: it returns 200 with a small placeholder graphic
    // (NOT an error), so the browser loads "successfully" with the wrong
    // picture. no-referrer strips the Referer entirely, which the CDN
    // treats the same as a same-site request and serves the real image.
    banner.referrerPolicy = 'no-referrer';
    // A cached URL can still go stale (wiki renames/removes the file); drop
    // the element rather than show a broken-image icon. Deliberately not
    // loading="lazy": tested and found it suppresses the error event for
    // network-level failures (DNS/unreachable host) in this browser, which
    // would silently defeat this exact fallback — event grids here are
    // modest (a few dozen cards, 30-min cached), so eager loading is cheap.
    banner.addEventListener('error', () => banner.remove());
    banner.src = ev.imageUrl;
    card.appendChild(banner);
  }

  const header = el('div', { className: 'event-card-header' });
  header.appendChild(el('h3', { className: 'event-name', text: ev.name }));
  if (ev.status === 'ended' || ev.status === 'unknown') {
    header.appendChild(el('span', { className: `event-status-badge status-${ev.status}`, text: ev.status }));
  }
  card.appendChild(header);

  if (ev.description) {
    card.appendChild(el('p', { className: 'event-summary', text: ev.description }));
  }

  const featured = ev.characters.length > 0 ? ev.characters.join(', ') : ev.reward;
  if (featured) {
    const rewardLine = el('p', { className: 'event-reward' });
    rewardLine.appendChild(el('strong', { text: ev.characters.length > 0 ? 'Featured: ' : 'Reward: ' }));
    rewardLine.appendChild(document.createTextNode(featured));
    card.appendChild(rewardLine);
  }

  card.appendChild(renderTimes(ev, region));

  if (ev.requirements.length > 0) {
    const details = el('details', { className: 'event-eligibility' });
    details.appendChild(el('summary', { text: 'Eligibility' }));
    const list = el('ul');
    for (const req of ev.requirements) {
      list.appendChild(el('li', { text: req }));
    }
    details.appendChild(list);
    card.appendChild(details);
  }

  if (ev.hoyolabLinks.length > 0) {
    const linkPara = el('p', { className: 'event-link' });
    const a = el('a', { text: 'HoYoLAB article ↗' });
    a.href = ev.hoyolabLinks[0];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    linkPara.appendChild(a);
    card.appendChild(linkPara);
  }

  return card;
}
