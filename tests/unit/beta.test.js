// The native app's beta page (public/beta/, served at /coldgas/beta/): its own title, description and canonical, the
// public TestFlight invite, nothing from another host but that invite, served no-transform like the other pages (no
// analytics beacon), every image it names shipped beside it with its size set, and linked from the title.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { HTML_PAGES } from '../../scripts/static-headers.mjs';

const page = readFileSync(new URL('../../public/beta/index.html', import.meta.url), 'utf8');
const meta = (name) => (page.match(new RegExp(`<meta name="${name}" content="([^"]*)"`)) || [])[1] || '';
const INVITE = 'https://testflight.apple.com/join/yMb3sJPg';

describe('the beta page', () => {
  it('has its title, description and canonical', () => {
    const title = page.match(/<title>([^<]*)<\/title>/)[1];
    expect(title).toMatch(/^COLD GAS for iPhone/);
    expect(title.length).toBeLessThan(65);
    expect(meta('description').length).toBeGreaterThanOrEqual(70);
    expect(meta('description').length).toBeLessThanOrEqual(160);
    expect(page).toContain('<link rel="canonical" href="https://mutaafaziz.com/coldgas/beta/">');
  });

  it('links the TestFlight invite and nothing else off the site', () => {
    expect(page).toContain(`href="${INVITE}"`);
    const offsite = [...page.matchAll(/(?:href|src)="(https?:)?\/\/([^"]+)"/g)].map((m) => m[0])
      .filter((a) => !a.includes(INVITE) && !a.includes('mutaafaziz.com/coldgas/'));
    expect(offsite).toEqual([]);
    expect(page).not.toMatch(/<script[^>]+src=/i);
    expect(page).not.toMatch(/—|&mdash;/);
  });

  it('ships every image it names, each with its width and height', () => {
    for (const m of page.matchAll(/<img[^>]*>/g)) {
      const src = m[0].match(/src="([^"]+)"/)[1];
      expect(existsSync(new URL(`../../public/beta/${src}`, import.meta.url)), src).toBe(true);
      expect(m[0]).toMatch(/width="\d+"/);
      expect(m[0]).toMatch(/height="\d+"/);
    }
  });

  it('honours reduced motion: no motion classes unless the reader allows it', () => {
    expect(page).toContain("if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;");
  });

  it('is served no-transform on every spelling of its path', () => {
    for (const p of ['/coldgas/beta', '/coldgas/beta/', '/coldgas/beta/index.html']) expect(HTML_PAGES).toContain(p);
  });

  it('the title links to it from the top bar', () => {
    expect(readFileSync(new URL('../../index.html', import.meta.url), 'utf8')).toMatch(/<a class="chip beta-chip" href="beta\/"/);
  });
});
