import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveImageUrl } from '../src/data/wiki/client.ts';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveImageUrl', () => {
  it('returns the thumbnail URL when the API resolves the file', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        query: {
          pages: [
            {
              imageinfo: [
                {
                  url: 'https://static.wikia.nocookie.net/full.png',
                  thumburl: 'https://static.wikia.nocookie.net/thumb-500.png',
                },
              ],
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const url = await resolveImageUrl('genshin-impact.fandom.com', 'Sunny Summer Fontinalia Event.png', 500);

    expect(url).toBe('https://static.wikia.nocookie.net/thumb-500.png');
    const requestedUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestedUrl.searchParams.get('titles')).toBe('File:Sunny Summer Fontinalia Event.png');
    expect(requestedUrl.searchParams.get('iiurlwidth')).toBe('500');
    expect(requestedUrl.searchParams.get('origin')).toBe('*');
  });

  it('falls back to the full-size url when no thumbnail is returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ query: { pages: [{ imageinfo: [{ url: 'https://static.wikia.nocookie.net/full.png' }] }] } }),
      ),
    );

    const url = await resolveImageUrl('genshin-impact.fandom.com', 'X.png', 500);
    expect(url).toBe('https://static.wikia.nocookie.net/full.png');
  });

  it('returns null when the file is missing (no imageinfo)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ query: { pages: [{ missing: true }] } })));

    const url = await resolveImageUrl('genshin-impact.fandom.com', 'Nonexistent.png', 500);
    expect(url).toBeNull();
  });

  it('returns null rather than throwing when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const url = await resolveImageUrl('genshin-impact.fandom.com', 'X.png', 500);
    expect(url).toBeNull();
  });
});
