/** A `<section>` wrapping one heading and a grid of already-rendered cards —
 * the shape both the Events tab's category sections (`app.ts`) and the
 * Banners tab's category sections (`bannersView.ts`) share. Callers own
 * building the heading element and each card node; this only owns the
 * wrapping. */
export function renderCardSection(sectionClassName: string, heading: HTMLElement, cardNodes: HTMLElement[]): HTMLElement {
  const section = document.createElement('section');
  section.className = sectionClassName;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'event-grid';
  for (const node of cardNodes) grid.appendChild(node);
  section.appendChild(grid);

  return section;
}
