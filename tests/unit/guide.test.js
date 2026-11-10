// The player's guide (public/guide/, served at /coldgas/guide/): a real, readable page in the initial HTML
// (no script needed), with its own title, description and canonical, served no-transform like the other
// pages (no analytics beacon), loading nothing from another host, and linked from the title.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { HTML_PAGES } from '../../scripts/static-headers.mjs';

const page = readFileSync(new URL('../../public/guide/index.html', import.meta.url), 'utf8');
const body = page.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const meta = (name) => (page.match(new RegExp(`<meta name="${name}" content="([^"]*)"`)) || [])[1] || '';

describe('the player\'s guide', () => {
  it('has its title, description and canonical', () => {
    const title = page.match(/<title>([^<]*)<\/title>/)[1];
    expect(title).toMatch(/^COLD GAS Guide/);
    expect(title.length).toBeLessThan(65);
    expect(meta('description').length).toBeGreaterThanOrEqual(70);
    expect(meta('description').length).toBeLessThanOrEqual(160);
    expect(page).toContain('<link rel="canonical" href="https://mutaafaziz.com/coldgas/guide/">');
    expect(page).toContain('<meta name="viewport"');
  });

  it('is readable without JavaScript: 900+ words, no scripts, nothing from another host', () => {
    expect(page).toContain('<h1>COLD GAS Player Guide</h1>');
    expect(body.split(' ').filter(Boolean).length).toBeGreaterThan(900);
    expect(page).not.toMatch(/<script/i);
    expect(page.replace(/<link rel="canonical"[^>]*>/, '')).not.toMatch(/<(link|img|iframe|script)[^>]+(src|href)="(https?:)?\/\//i);
    expect(page).not.toMatch(/—|&mdash;/);
  });

  it('is served no-transform on every spelling of its path', () => {
    for (const p of ['/coldgas/guide', '/coldgas/guide/', '/coldgas/guide/index.html']) expect(HTML_PAGES).toContain(p);
  });

  it('links back to the game, and the title links to it', () => {
    expect(page).toMatch(/<a class="play" href="\.\.\/">/);
    expect(readFileSync(new URL('../../index.html', import.meta.url), 'utf8')).toMatch(/<a href="guide\/">How to play<\/a>/);
  });
});
