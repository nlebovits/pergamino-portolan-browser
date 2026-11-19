// Verification for the IDE Pergamino browser.
//
// It drives a real browser against the running site and asserts what the
// approved design promises. The inherited tests/e2e suite asserts the upstream
// multi-catalog product, so it does not apply here.
//
// Expected values (categories, layer counts, sources, featured layers) come
// from the catalog at run time, and the home settings from home.config.js.
// When either changes, the expectations follow.
//
// Catalog-dependent checks skip, and do not fail, while the catalog is offline.
//
// The map probe needs Vue component internals, which a production build
// strips. Run against the dev server, or build with STAC_BROWSER_E2E=true.
//
// MapLibre renders only when the tab is visible. Headless Chromium uses
// SwiftShader by default, which draws only the top half of a 555 px map canvas.
// The script asks for the hardware GPU through ANGLE. Set VERIFY_GL=swiftshader
// to use the default renderer.
//
// Usage:
//   npx serve ../pergamino-ide-catalog/catalog --cors -l 8081 &
//   SB_catalogUrl=http://localhost:8081/catalog.json \
//     node_modules/.bin/vite --port 8080 --strictPort &
//   CATALOG_URL=http://localhost:8081/catalog.json \
//     node verify-pergamino.mjs [baseUrl]
//
// Screenshots land in ./verify-out (override with VERIFY_OUT).
//
// VERIFY_FEATURE=path,path tags those collections (catalog paths without
// /collection.json) with the featured keyword in flight, in this browser
// only. Use it to test the featured section before the catalog tags a layer.

/* global process, fetch, URL */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import homeConfig from './home.config.js';

const BASE = process.argv[2] || 'http://localhost:8080';
const OUT = process.env.VERIFY_OUT || './verify-out';
const CATALOG_URL = process.env.CATALOG_URL || 'https://data.source.coop/nlebovits/pergamino-ide/catalog.json';

// The approved tokens (src/theme/variables.scss), as the browser reports them.
const TOKENS = {
  ink: 'rgb(35, 30, 38)',          // $per-ink, #231e26
  muted: 'rgb(108, 99, 112)',      // $per-muted, #6c6370
  paper: 'rgb(255, 255, 255)',     // $per-paper, #fff
  raise: 'rgb(239, 233, 241)',     // $per-raise, #efe9f1
  pageBg: 'rgb(247, 244, 248)',    // $per-night, #f7f4f8
  sol: 'rgb(251, 205, 73)',        // $per-sol, #fbcd49
  line: 'rgb(221, 212, 224)',       // $per-line, #ddd4e0
  rosa: 'rgb(240, 127, 175)',      // $per-rosa, #f07faf
  font: /^"?Chivo"?,/,
  mono: /^"?Chivo Mono"?,/,
};
const RULE_WIDTH = '3px';          // $per-rule-height
const PAGE_SIZE = 8;               // src/components/PerHome.vue
const EMERGENCY = ['911', '100', '103', '107', '144', 'BOMBEROS', 'POLICÍA', 'DEFENSA CIVIL'];

// basemaps.config.js, MAP_CONSTRAINTS.
const MAP = { minZoom: 8, maxZoom: 19, maxBounds: [[-61.75, -34.82], [-59.33, -32.9]] };
const BASEMAP_COUNT = 4;
const TILE_HOSTS = /cartocdn\.com|cholmes\.github\.io|\.pmtiles/;

const FEATURE_PATHS = (process.env.VERIFY_FEATURE || '').split(',').map(x => x.trim()).filter(Boolean);

// Representative states. Each entry names the catalog path of a collection.
// These ids appear only in this script, never in the browser code.
const COLLECTIONS = [
  { key: 'large', path: 'catastro/medida_lado/collection.json', note: '196,722 points, over MAX_ROWS' },
  { key: 'point', path: 'salud/caps/collection.json', note: '30 points' },
  { key: 'line', path: 'transporte/colectivos_urbanos/collection.json', note: 'LineString' },
  { key: 'polygon', path: 'demografia/icv/collection.json', note: 'Polygon with a legend' },
  { key: 'inta', path: 'ambiente-y-agro/inta_mnc_2018_2019/collection.json', note: 'INTA producer' },
  { key: 'arba', path: 'catastro/parcela/collection.json', note: 'ARBA producer' },
  { key: 'table', path: 'vialidad/callejero_listado/collection.json', note: 'no geometry' },
];

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
// A check that the catalog owns. It reports a catalog finding and does not
// fail the browser, because the fix belongs in pergamino-ide-catalog.
const catalogFindings = [];
function catalogCheck(name, pass, detail) {
  if (!pass) catalogFindings.push(name);
  console.log(`${pass ? 'PASS' : 'CATALOG'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function skip(name, detail) {
  console.log(`SKIP  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---------- Expected values, read from the catalog ----------
async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
// The source of a layer, as src/utils/perHome.js sourceOf() reads it.
function sourceOf(json) {
  const providers = Array.isArray(json.providers) ? json.providers : [];
  const named = providers.filter(p => typeof p?.name === 'string' && p.name.trim());
  const producer = named.find(p => (p.roles || []).includes('producer'));
  return (producer || named[0])?.name.trim() || '';
}
function isFeatured(json, url) {
  const word = String(homeConfig.featuredKeyword || '').trim().toLowerCase();
  const tagged = FEATURE_PATHS.some(f => url.endsWith(`/${f}/collection.json`));
  return Boolean(word) && (tagged || (json.keywords || []).some(k => String(k).trim().toLowerCase() === word));
}
async function readCatalog() {
  const root = await getJson(CATALOG_URL);
  const topics = [];
  const collections = [];
  for (const link of root.links.filter(l => l.rel === 'child')) {
    const url = new URL(link.href, CATALOG_URL).href;
    const topic = await getJson(url);
    const children = topic.links.filter(l => l.rel === 'child').map(l => new URL(l.href, url).href);
    topics.push({ title: topic.title || link.title, path: new URL(url).pathname, count: children.length, children });
    for (const child of children) {
      collections.push(getJson(child).then(json => ({ url: child, json, topic: topic.title || link.title })));
    }
  }
  const loaded = await Promise.all(collections);
  const counts = new Map();
  for (const { json } of loaded) {
    const name = sourceOf(json);
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  const sources = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'es'));
  const featured = loaded.filter(({ json, url }) => isFeatured(json, url)).slice(0, homeConfig.featuredLimit ?? 3);
  return { root, topics, collections: loaded, sources, featured };
}

let catalog = null;
try {
  catalog = await readCatalog();
  const cache = await fetch(CATALOG_URL, { method: 'HEAD' }).then(r => r.headers.get('cache-control')).catch(() => null);
  console.log(`INFO  catalog: ${catalog.topics.length} topics, ${catalog.collections.length} collections; cache-control: ${cache ?? 'none'}`);
}
catch (e) {
  skip('catalog checks', `catalog not reachable at ${CATALOG_URL}: ${e.message}`);
}
const catalogBase = new URL('.', CATALOG_URL).pathname;
const route = path => `${BASE}/#/${path}`;

// Reaches the live MapLibre instance through the Vue tree.
const MAP_PROBE = `(() => {
  let node = document.querySelector('.maplibregl-map');
  while (node) {
    let c = node.__vueParentComponent;
    while (c) {
      if (c.proxy && c.proxy.map && c.proxy.map.getStyle) return c.proxy.map;
      c = c.parent;
    }
    node = node.parentElement;
  }
  return null;
})()`;

const glArgs = process.env.VERIFY_GL === 'swiftshader' ? [] : ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: glArgs });
const page = await browser.newPage({ viewport: DESKTOP });
if (FEATURE_PATHS.length && homeConfig.featuredKeyword) {
  await page.route(/\/collection\.json$/, async r => {
    const url = r.request().url();
    const response = await r.fetch();
    if (!FEATURE_PATHS.some(f => url.endsWith(`/${f}/collection.json`))) return r.fulfill({ response });
    const json = await response.json();
    json.keywords = [...(json.keywords || []), homeConfig.featuredKeyword];
    return r.fulfill({ response, json });
  });
  console.log(`INFO  featured keyword added in flight to: ${FEATURE_PATHS.join(', ')}`);
}

const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`${page.url()} :: ${m.text()}`); });
page.on('pageerror', e => consoleErrors.push(`${page.url()} :: pageerror: ${e.message}`));
const tileRequests = [];
page.on('request', r => { if (TILE_HOSTS.test(r.url())) tileRequests.push(r.url()); });

async function open(url, wait = 3000) {
  await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(wait);
}
async function noOverflow(label) {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`no horizontal overflow: ${label}`, o === 0, `${o}px`);
}
async function shoot(name, vp) {
  await page.screenshot({ path: `${OUT}/${name}-${vp}.png`, fullPage: vp === 'mobile' });
}

// ---------- 1. Home: branding shell ----------
await open(route(''));
const shell = await page.evaluate(() => {
  const cs = e => e && getComputedStyle(e);
  const header = document.querySelector('.per-header');
  const logo = document.querySelector('.per-logo');
  const footer = document.querySelector('#stac-browser > footer');
  const h1 = document.querySelector('h1');
  return {
    headerBg: cs(header)?.backgroundColor,
    headerRule: cs(header)?.borderImageSource,
    headerRuleWidth: cs(header)?.borderBottomWidth,
    actions: [...document.querySelectorAll('.per-header .per-action')].map(a => a.innerText.trim()).filter(Boolean),
    sourceLink: document.querySelector('.per-header .per-source-link')?.href || '',
    sourceLabel: document.querySelector('.per-header .per-source-link')?.getAttribute('aria-label') || '',
    icons: document.querySelectorAll('.per-header svg').length,
    demo: document.querySelector('.per-header .per-demo')?.innerText.trim() || '',
    demoLink: document.querySelector('.per-header .per-demo a')?.href || '',
    demoTop: document.querySelector('.per-header .per-demo')?.getBoundingClientRect().top,
    demoBg: cs(document.querySelector('.per-header .per-demo'))?.backgroundColor,
    demoWidth: document.querySelector('.per-header .per-demo')?.getBoundingClientRect().width,
    barBottom: document.querySelector('.per-header .per-inner')?.getBoundingClientRect().bottom,
    brandHref: document.querySelector('.per-brand')?.getAttribute('href'),
    logoSrc: logo?.getAttribute('src'),
    logoLoaded: !!logo && logo.complete && logo.naturalWidth > 0,
    logoAlt: logo?.getAttribute('alt'),
    wordmark: document.querySelector('.per-wordmark .header-title')?.innerText.trim(),
    docTitle: document.title,
    lang: document.documentElement.lang,
    favicon: document.querySelector('link[rel=icon]')?.getAttribute('href'),
    bodyFont: cs(document.body).fontFamily,
    bodyColor: cs(document.body).color,
    bodyBg: cs(document.body).backgroundColor,
    h1Font: cs(h1)?.fontFamily,
    h1Color: cs(h1)?.color,
    footerRule: cs(footer)?.borderImageSource,
    footerRuleWidth: cs(footer)?.borderTopWidth,
    footerText: footer?.innerText || '',
    footerLinks: [...(footer?.querySelectorAll('a') || [])].map(a => ({ text: a.innerText.trim(), href: a.href })),
    footerIcons: [...(footer?.querySelectorAll('.per-footer-icons a') || [])].map(a => ({ label: a.getAttribute('aria-label'), svg: !!a.querySelector('svg') })),
    edges: ['.per-logo', '.per-hero h1', '#stac-browser > footer .per-footer'].map(sel => Math.round(document.querySelector(sel)?.getBoundingClientRect().left ?? -1)),
  };
});
check('header is a white bar', shell.headerBg === TOKENS.paper, shell.headerBg);
check(`header has the ${RULE_WIDTH} brand rule`, shell.headerRuleWidth === RULE_WIDTH && shell.headerRule?.includes(TOKENS.sol) && shell.headerRule?.includes(TOKENS.rosa), `${shell.headerRuleWidth} ${shell.headerRule}`);
check('header has no navigation, only "Acerca del catálogo"', JSON.stringify(shell.actions) === JSON.stringify(['Acerca del catálogo']), shell.actions.join(' | '));
check('header has one icon, the GitHub link to the browser source', shell.icons === 1 && shell.sourceLink === homeConfig.sourceUrl && shell.sourceLabel.length > 0, `${shell.icons} svg; ${shell.sourceLink}`);
check('logo and wordmark link to the home page', typeof shell.brandHref === 'string', shell.brandHref);
check('dark municipal logo loads', shell.logoLoaded && /pergamino\/logo-municipalidad-tinta\.svg$/.test(shell.logoSrc || ''), shell.logoSrc);
check('logo has alt text', shell.logoAlt === 'Municipalidad de Pergamino', shell.logoAlt);
check('wordmark reads the catalog title', shell.wordmark === 'IDE Pergamino', shell.wordmark);
check('document title follows the page', /IDE Pergamino/.test(shell.docTitle), shell.docTitle);
check('html lang is es', shell.lang === 'es', shell.lang);
check('favicon is the municipal icon', /pergamino\/favicon-32\.png$/.test(shell.favicon || ''), shell.favicon);
check('body font is Chivo', TOKENS.font.test(shell.bodyFont || ''), shell.bodyFont);
check('heading font is Chivo', TOKENS.font.test(shell.h1Font || ''), shell.h1Font);
check('Chivo and Chivo Mono load', await page.evaluate(() => document.fonts.check('16px Chivo') && document.fonts.check('16px "Chivo Mono"')));
check('body text is #231e26', shell.bodyColor === TOKENS.ink, shell.bodyColor);
check('page background is #f7f4f8', shell.bodyBg === TOKENS.pageBg, shell.bodyBg);
check('h1 is #231e26', shell.h1Color === TOKENS.ink, shell.h1Color);
check(`footer has the ${RULE_WIDTH} brand rule`, shell.footerRuleWidth === RULE_WIDTH && shell.footerRule?.includes(TOKENS.sol), `${shell.footerRuleWidth} ${shell.footerRule}`);
check('header says the site is a demo and not official', /^🚧/.test(shell.demo) && /demostración, no un sitio oficial/.test(shell.demo), shell.demo);
check('demo notice links the official site', shell.demoLink === homeConfig.officialSiteUrl, shell.demoLink);
check('demo notice is a yellow strip under the bar, across the window', shell.demoBg === TOKENS.sol && Math.abs(shell.demoTop - shell.barBottom) < 1 && shell.demoWidth >= DESKTOP.width - 20, `${shell.demoBg}, ${Math.round(shell.demoWidth)}px wide`);
check('footer has no demo notice', !/demostración/.test(shell.footerText));
check('footer shows the Municipalidad contact', shell.footerText.includes(homeConfig.footer.contact.email) && shell.footerText.includes(homeConfig.footer.contact.address));
const emergency = EMERGENCY.filter(n => new RegExp(`(^|\\D)${n}(\\D|$)`).test(shell.footerText) || shell.footerLinks.some(l => l.href === `tel:${n}`));
check('footer lists no emergency numbers', emergency.length === 0, emergency.join(', ') || 'none');
const fl = shell.footerLinks;
const labels = fl.map(l => l.text).join(' | ');
check('footer links to the data', fl.some(l => l.href.includes('source.coop')), labels);
check('footer links to the official GeoNode viewer', fl.some(l => l.href.includes('geonode.pergamino.gob.ar')), labels);
check('footer links to pergamino.ar', fl.some(l => /^https:\/\/pergamino\.ar\/?$/.test(l.href)), labels);
check('footer links to the license', fl.some(l => l.href.includes('creativecommons.org/licenses/by-sa/4.0')), labels);
check('footer links to the source code', fl.some(l => l.href.includes('github.com')), labels);
const social = homeConfig.footer.columns.flatMap(c => c.links).filter(l => l.icon);
check(`footer shows ${social.length} social networks as named icons`, shell.footerIcons.length === social.length && shell.footerIcons.every((x, i) => x.svg && x.label === social[i].label), shell.footerIcons.map(x => x.label).join(' | '));
// The layout spans the window. Content keeps the gutter from its edges.
const edge = Math.max(20, Math.min(56, DESKTOP.width * 0.04));
check(`logo, hero text and footer keep the ${edge}px gutter`, shell.edges.every(x => Math.abs(x - edge) <= 1), shell.edges.join(', '));

// Hover and keyboard focus of the header action.
await page.hover('.per-header .per-action');
await page.waitForTimeout(300);
const action = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.per-header .per-action')); return { bg: s.backgroundColor, color: s.color }; });
check('header action hover is #efe9f1', action.bg === TOKENS.raise, action.bg);
await page.mouse.move(0, 600);
await page.focus('.per-brand');
await page.keyboard.press('Tab');
const focus = await page.evaluate(() => { const a = document.activeElement; return a && getComputedStyle(a).outlineStyle + ' ' + getComputedStyle(a).outlineColor; });
check('header focus ring is visible', /solid/.test(focus || ''), focus);
await page.click('#popover-root-btn');
await page.waitForTimeout(800);
check('"Acerca del catálogo" opens the catalog statistics', await page.locator('#popover-root').isVisible().catch(() => false));
await page.keyboard.press('Escape');
await page.mouse.click(5, 300);

// ---------- 2. Home: hero map ----------
const hero = homeConfig.hero;
const heroInfo = await page.evaluate(() => ({
  h1: document.querySelector('.per-hero h1')?.innerText.trim(),
  views: [...document.querySelectorAll('.per-hero-views button')].map(b => b.innerText.trim()),
  pressed: document.querySelector('.per-hero-views button[aria-pressed="true"]')?.innerText.trim(),
  legend: document.querySelector('.per-hero-legend strong')?.innerText.trim(),
  credit: document.querySelector('.per-hero-credit')?.innerText.trim(),
  pageRow: !!document.querySelector('#stac-browser > header .page'),
  heroTop: document.querySelector('.per-hero')?.getBoundingClientRect().top,
  heroLine: getComputedStyle(document.querySelector('.per-hero')).borderBottom,
  headerBottom: document.querySelector('#stac-browser > header')?.getBoundingClientRect().bottom,
}));
check('hero headline', heroInfo.h1 === 'Pergamino, en datos abiertos', heroInfo.h1);
check('hero ends on a thin grey line', heroInfo.heroLine === `1px solid ${TOKENS.line}`, heroInfo.heroLine);
check('hero meets the header', Math.abs(heroInfo.heroTop - heroInfo.headerBottom) < 1, `${heroInfo.heroTop} vs ${heroInfo.headerBottom}`);
check('root has no title row', !heroInfo.pageRow);
if (hero) {
  check('view buttons follow home.config.js', JSON.stringify(heroInfo.views) === JSON.stringify(hero.views.map(v => v.label)), heroInfo.views.join(' | '));
  check('the first view opens', heroInfo.pressed === hero.views[0].label, heroInfo.pressed);
  check('legend of the first view shows', heroInfo.legend === hero.views[0].legend?.title, heroInfo.legend);
  check('imagery credits show', hero.imagery.every(i => !i.attribution || heroInfo.credit?.includes(i.attribution)), heroInfo.credit);
  // The view layers come from the PMTiles links of the catalog collections.
  await page.waitForFunction(`(() => { const m = ${MAP_PROBE}; return m && m.getStyle().layers.some(l => l.source && l.source.startsWith('pmtiles-')); })()`, null, { timeout: 45000 }).catch(() => {});
  await page.waitForFunction(`(() => { const m = ${MAP_PROBE}; return m && m.areTilesLoaded(); })()`, null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const heroMap = await page.evaluate(`(() => {
    const m = ${MAP_PROBE};
    if (!m) return null;
    const layers = m.getStyle().layers.filter(l => l.source && l.source.startsWith('pmtiles-'));
    const visible = layers.filter(l => (l.layout || {}).visibility !== 'none').map(l => l.id);
    return { layers: layers.length, visible, rendered: visible.length ? m.queryRenderedFeatures({ layers: visible }).length : 0, pitch: m.getPitch() };
  })()`);
  const expectLayers = hero.views.reduce((n, v) => n + (v.layers || []).length, 0);
  check(`hero map adds ${expectLayers} catalog layers`, heroMap?.layers === expectLayers, `${heroMap?.layers} layers`);
  check('first view draws features', (heroMap?.rendered || 0) > 0, `${heroMap?.rendered} features, pitch ${heroMap?.pitch?.toFixed(0)}`);
  await page.locator('.per-hero-views button', { hasText: hero.views[1].label }).click();
  await page.waitForTimeout(2500);
  const second = await page.evaluate(`(() => { const m = ${MAP_PROBE}; return m.getStyle().layers.filter(l => l.source && l.source.startsWith('pmtiles-') && (l.layout || {}).visibility !== 'none').map(l => l.id); })()`);
  check(`"${hero.views[1].label}" shows only its own layers`, second.length === hero.views[1].layers.length && second.every(id => id.startsWith(hero.views[1].id)), second.join(', '));
}
await shoot('01-home', 'desktop');

if (catalog) {
  // ---------- 3. Home: counts, featured layers, category browser ----------
  await page.waitForSelector('.per-readout', { timeout: 90000 }).catch(() => {});
  const readout = await page.evaluate(() => [...document.querySelectorAll('.per-readout strong')].map(e => Number(e.innerText)));
  const expectReadout = [catalog.collections.length, catalog.topics.length, catalog.sources.length];
  check('readout counts layers, categories and sources', JSON.stringify(readout) === JSON.stringify(expectReadout), `${readout.join(' / ')} (catalog ${expectReadout.join(' / ')})`);
  check('readout numbers use Chivo Mono', TOKENS.mono.test(await page.evaluate(() => getComputedStyle(document.querySelector('.per-readout strong')).fontFamily)));

  const featured = await page.evaluate(() => ({
    titles: [...document.querySelectorAll('.per-featured .per-tile-title')].map(e => e.innerText.trim()),
    categories: [...document.querySelectorAll('.per-featured .per-tile-category')].map(e => e.innerText.trim()),
    links: [...document.querySelectorAll('.per-featured a.per-tile')].map(a => a.getAttribute('href')),
  }));
  if (catalog.featured.length) {
    check(`featured shows the ${catalog.featured.length} tagged layers in catalog order`, JSON.stringify(featured.titles) === JSON.stringify(catalog.featured.map(f => f.json.title)), featured.titles.join(' | '));
    check('featured tiles name their category', JSON.stringify(featured.categories) === JSON.stringify(catalog.featured.map(f => f.topic)), featured.categories.join(' | '));
    check('featured tiles link to their layer', featured.links.every((href, i) => href?.endsWith(catalog.featured[i].url.slice(new URL(CATALOG_URL).origin.length + catalogBase.length))), featured.links.join(' | '));
  }
  else {
    check('featured section is hidden when no layer is tagged', featured.titles.length === 0, `${featured.titles.length} tiles`);
  }

  const chips = await page.evaluate(() => [...document.querySelectorAll('.per-chips button')].map(b => b.innerText.replace(/\s+/g, ' ').trim()));
  const expectChips = catalog.topics.map(t => `${t.title} ${t.count}`);
  check(`category chips list ${expectChips.length} categories in catalog order with counts`, JSON.stringify(chips) === JSON.stringify(expectChips), chips.join(' | '));
  const first = catalog.topics[0];
  const grid = async () => page.evaluate(() => ({
    tiles: document.querySelectorAll('.per-grid .per-tile').length,
    more: document.querySelector('.per-more button')?.innerText.trim(),
    summary: document.querySelector('#per-browser-heading + p')?.innerText.trim(),
  }));
  let g = await grid();
  check(`first category shows ${Math.min(PAGE_SIZE, first.count)} tiles`, g.tiles === Math.min(PAGE_SIZE, first.count), `${g.tiles} tiles; ${g.summary}`);
  if (first.count > PAGE_SIZE) {
    check('"Ver las N capas" names the count', g.more === `Ver las ${first.count} capas de ${first.title}`, g.more);
    await page.click('.per-more button');
    await page.waitForTimeout(500);
    g = await grid();
    check(`the button shows all ${first.count} layers`, g.tiles === first.count, `${g.tiles} tiles`);
    check('the expanded grid offers "Ver menos"', g.more === 'Ver menos', g.more);
    await page.click('.per-more button');
    await page.waitForTimeout(900);
    g = await grid();
    const back = await page.evaluate(() => {
      const head = document.querySelector('#per-browser-heading').getBoundingClientRect();
      const header = document.querySelector('#stac-browser > header').getBoundingClientRect();
      return { top: Math.round(head.top), headerBottom: Math.round(header.bottom), height: window.innerHeight };
    });
    check(`"Ver menos" collapses the grid to ${PAGE_SIZE} tiles`, g.tiles === PAGE_SIZE && g.more?.startsWith('Ver las'), `${g.tiles} tiles; ${g.more}`);
    check('"Ver menos" brings the browser heading back into view, under the header', back.top >= back.headerBottom && back.top < back.height, `heading at ${back.top}, header ends at ${back.headerBottom}`);
  }
  const other = catalog.topics[catalog.topics.length - 1];
  await page.locator('.per-chips button', { hasText: other.title }).click();
  await page.waitForTimeout(500);
  g = await grid();
  check(`a chip switches to "${other.title}"`, g.tiles === Math.min(PAGE_SIZE, other.count) && g.summary?.includes(other.title), `${g.tiles} tiles; ${g.summary}`);

  // Source filter.
  const options = await page.evaluate(() => [...document.querySelectorAll('#per-source-select option')].map(o => o.innerText.trim()));
  const expectOptions = ['Todas las fuentes', ...catalog.sources.map(([n, c]) => `${n} (${c})`)];
  check('source filter lists every source with its count', JSON.stringify(options) === JSON.stringify(expectOptions), `${options.length} options`);
  const arba = catalog.sources.find(([n]) => /ARBA/.test(n)) || catalog.sources[catalog.sources.length - 1];
  await page.selectOption('#per-source-select', arba[0]);
  await page.waitForTimeout(800);
  const filtered = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('.per-chips button')].map(b => ({ text: b.innerText.replace(/\s+/g, ' ').trim(), disabled: b.disabled })),
    sources: [...document.querySelectorAll('.per-grid .per-tile-source')].map(e => e.innerText.trim()),
    summary: document.querySelector('#per-browser-heading + p')?.innerText.trim(),
  }));
  const arbaTotal = filtered.chips.reduce((n, c) => n + Number(c.text.split(' ').pop()), 0);
  check(`chip counts add up to the ${arba[1]} layers of the source`, arbaTotal === arba[1], `${arbaTotal}`);
  check('chips without a layer of the source are disabled', filtered.chips.every(c => c.disabled === c.text.endsWith(' 0')));
  check('every tile shows the chosen source', filtered.sources.length > 0 && filtered.sources.every(x => x === arba[0]), `${filtered.sources.length} tiles`);
  check('the summary names the source', filtered.summary?.includes(arba[0]), filtered.summary);
  await shoot('02-home-filtered', 'desktop');
  await page.selectOption('#per-source-select', { index: 0 });

  // Search, from the "/" key.
  await page.mouse.click(5, 5);
  await page.keyboard.press('/');
  check('"/" moves the focus to the search field', await page.evaluate(() => document.activeElement?.id === 'per-search-input'));
  const term = 'parcela';
  await page.keyboard.type(term);
  await page.waitForTimeout(600);
  const search = await page.evaluate(() => ({
    heading: document.querySelector('#per-browser-heading')?.innerText.trim(),
    chips: document.querySelectorAll('.per-chips button').length,
    titles: [...document.querySelectorAll('.per-grid .per-tile-title')].map(e => e.innerText.trim()),
  }));
  const fold = t => String(t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const expectMatches = catalog.collections.filter(({ json, topic }) => fold([json.title, json.description, sourceOf(json), topic, ...(json.keywords || [])].join(' ')).includes(term));
  check('search shows a results heading and hides the chips', search.heading === 'Resultados de la búsqueda' && search.chips === 0, search.heading);
  check(`search for "${term}" finds ${expectMatches.length} layers`, search.titles.length === Math.min(PAGE_SIZE, expectMatches.length), `${search.titles.length} tiles`);
  await page.fill('#per-search-input', '');

  // Two clicks from home to a collection: a chip, then a tile.
  await page.locator('.per-chips button').first().click();
  await page.locator('.per-grid a.per-tile').first().click();
  await page.waitForSelector('.maplibregl-map', { timeout: 30000 }).catch(() => {});
  // Let the map finish before the next navigation. Upstream MapView throws
  // "reading 'isEmpty'" when a page is left while its assets still load.
  await page.waitForFunction(`(() => { const m = ${MAP_PROBE}; return !m || (m.isStyleLoaded() && m.areTilesLoaded()); })()`, null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3000);
  check('a tile opens its layer', /collection\.json$/.test(page.url()), page.url());

  // QGIS band and the stock layout.
  await open(route(''), 1500);
  const qgis = await page.evaluate(() => ({
    href: document.querySelector('.per-qgis a')?.href,
    steps: document.querySelectorAll('.per-qgis li').length,
    meta: !!document.querySelector('.cc .meta'),
    stock: !!document.querySelector('.catalogs-container'),
  }));
  check('QGIS band links the plugin', qgis.href === homeConfig.qgisPluginUrl && qgis.steps === 3, qgis.href);
  const band = async () => page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.per-qgis [role="tab"]')].map(t => ({ text: t.innerText.trim(), selected: t.getAttribute('aria-selected') === 'true' })),
    panel: document.querySelector('.per-qgis [role="tabpanel"]')?.getAttribute('aria-labelledby'),
    code: document.querySelector('.per-qgis pre code')?.textContent || '',
    focus: document.activeElement?.id || '',
  }));
  let b = await band();
  check('the band has tabs for QGIS, Python and DuckDB, with QGIS open', b.tabs.map(t => t.text).join('|') === 'QGIS|Python|DuckDB' && b.tabs[0].selected && b.panel === 'per-tab-qgis', b.tabs.map(t => `${t.text}${t.selected ? '*' : ''}`).join(' | '));
  await page.focus('#per-tab-qgis');
  await page.keyboard.press('Tab');
  b = await band();
  check('Tab moves from the QGIS tab to the Python tab', b.focus === 'per-tab-python', b.focus);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  b = await band();
  const parquetUrl = (b.code.match(/url = "([^"]+\.parquet)"/) || [])[1];
  check('the Python tab shows a read_parquet example', b.panel === 'per-tab-python' && /read_parquet\(url\)/.test(b.code) && !!parquetUrl, parquetUrl);
  const head = parquetUrl ? await page.request.fetch(parquetUrl, { method: 'HEAD' }) : null;
  check('the example file exists', head?.status() === 200, `${head?.status()} ${parquetUrl}`);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  b = await band();
  check('ArrowRight opens the DuckDB tab and focuses it', b.panel === 'per-tab-duckdb' && b.focus === 'per-tab-duckdb' && b.code.includes(`FROM '${parquetUrl}'`), b.code.split('\n').join(' / '));
  check('root description column is hidden', !qgis.meta);
  check('stock catalog grid is hidden on the root', !qgis.stock);

  // ---------- 4. Topic page (Catastro) ----------
  const catastro = catalog.topics.find(t => t.title === 'Catastro') || catalog.topics[0];
  const topicPath = catastro.path.slice(catalogBase.length);
  await open(route(topicPath), 4000);
  await page.waitForFunction(() => [...document.querySelectorAll('.catalog-card img')].every(i => i.complete), null, { timeout: 30000 }).catch(() => {});
  const topic = await page.evaluate(() => ({
    h1: document.querySelector('h1')?.innerText.trim(),
    heading: document.querySelector('.catalogs > header h2')?.innerText.trim(),
    badge: document.querySelector('.catalogs > header .badge')?.innerText.trim(),
    cards: document.querySelectorAll('.catalog-card').length,
    thumbs: [...document.querySelectorAll('.catalog-card img')].map(i => ({ ok: i.naturalWidth > 0, ratio: i.naturalWidth / (i.naturalHeight || 1), src: i.getAttribute('src') })),
  }));
  check(`topic page lists ${catastro.count} collections`, topic.cards === catastro.count, `${topic.cards} cards`);
  check('topic grid heading says "Capas"', topic.heading === 'Capas', `${topic.heading} (${topic.badge})`);
  const broken = topic.thumbs.filter(t => !t.ok).length;
  check('topic thumbnails load', topic.thumbs.length > 0 && broken === 0, `${topic.thumbs.length - broken}/${topic.thumbs.length} loaded`);
  const offRatio = topic.thumbs.filter(t => t.ok && Math.abs(t.ratio - 1.5) >= 0.02);
  catalogCheck('topic thumbnails are 3:2', offRatio.length === 0, offRatio.map(t => `${t.ratio.toFixed(2)} ${t.src.split('/').slice(-2).join('/')}`).join(', ') || 'all 1.50');
  await noOverflow('topic page desktop');
  await shoot('03-topic-catastro', 'desktop');

  // ---------- 5. Collections ----------
  for (const c of COLLECTIONS) {
    const json = catalog.collections.find(x => x.url.endsWith(`/${c.path}`))?.json;
    if (!json) {
      skip(`collection ${c.path}`, 'not in the catalog');
      continue;
    }
    tileRequests.length = 0;
    await open(route(c.path), 2000);
    await page.waitForFunction(`(() => { const m = ${MAP_PROBE}; return !m || (m.isStyleLoaded() && m.areTilesLoaded()); })()`, null, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const info = await page.evaluate(`(() => {
      const m = ${MAP_PROBE};
      const text = document.body.innerText;
      const layers = m ? m.getStyle().layers : [];
      const data = layers.filter(l => !/^(stac-footprint)/.test(l.id) && l.source && l.source !== 'carto' && !/basemap|carto|openmaptiles/.test(l.source));
      return {
        h1: document.querySelector('h1')?.innerText.trim(),
        map: !!m,
        minZoom: m?.getMinZoom(), maxZoom: m?.getMaxZoom(),
        maxBounds: m?.getMaxBounds()?.toArray(),
        dataLayers: data.map(l => l.id + ':' + l.type),
        rendered: m && data.length ? m.queryRenderedFeatures({ layers: data.map(l => l.id) }).length : 0,
        footprint: layers.some(l => l.id.startsWith('stac-footprint')),
        legend: !!document.querySelector('.legend, .map-legend, [class*=legend] .swatch, [class*=legend] li'),
        license: /CC-BY-SA-4\\.0/.test(text),
        providers: [...document.querySelectorAll('.providers .provider-name, .providers .card-header, .providers summary, .providers button')].map(e => e.innerText.trim()).filter(Boolean),
        viaLink: [...document.querySelectorAll('a')].some(a => /ide\\.pergamino\\.gob\\.ar/.test(a.href)),
        download: [...document.querySelectorAll('a')].some(a => /\\.parquet($|\\?)/.test(a.href)),
        english: ['Data Preview', 'Filter rows', 'All columns', 'Original source', 'Human-readable documentation'].filter(s => text.includes(s)),
      };
    })()`);
    const tag = `${c.key} (${c.path})`;
    check(`${tag}: page title is the collection title`, info.h1 === json.title, info.h1);
    check(`${tag}: license shown`, info.license);
    const producerNames = (json.providers || []).filter(p => (p.roles || []).includes('producer')).map(p => p.name);
    const providerText = await page.locator('.providers').innerText().catch(() => '');
    check(`${tag}: producer shown`, producerNames.every(n => providerText.includes(n)), producerNames.join(', '));
    check(`${tag}: source link to the original service shown`, info.viaLink);
    check(`${tag}: parquet download offered`, info.download);
    if (json['geoparquet:geometry_type']) {
      check(`${tag}: map renders`, info.map);
      check(`${tag}: map minZoom ${MAP.minZoom}`, info.minZoom === MAP.minZoom, String(info.minZoom));
      check(`${tag}: map maxBounds`, JSON.stringify(info.maxBounds) === JSON.stringify(MAP.maxBounds), JSON.stringify(info.maxBounds));
      check(`${tag}: data layers from the catalog style`, info.dataLayers.length > 0, info.dataLayers.join(', '));
      const rows = json['geoparquet:feature_count'];
      console.log(`INFO  ${tag}: ${info.rendered} rendered features at the opening view, ${rows} rows`);
    }
    else {
      console.log(`INFO  ${tag}: no geometry; map=${info.map} footprint=${info.footprint}`);
    }
    if (info.english.length) console.log(`INFO  ${tag}: English strings: ${info.english.join(', ')}`);
    await noOverflow(`${c.key} desktop`);
    await shoot(`04-${c.key}`, 'desktop');
  }

  // ---------- 6. Map constraints in use ----------
  await open(route(COLLECTIONS[1].path), 6000);
  const clamp = await page.evaluate(`(async () => {
    const m = ${MAP_PROBE};
    if (!m) return null;
    m.jumpTo({ center: [-58.38, -34.6], zoom: 9 });
    const panned = m.getCenter().toArray();
    m.jumpTo({ zoom: 3 });
    return { panned, zoom: m.getZoom() };
  })()`);
  if (clamp) {
    const [lng, lat] = clamp.panned;
    check('panning to Buenos Aires stays inside maxBounds', lng <= MAP.maxBounds[1][0] && lat >= MAP.maxBounds[0][1], `${lng.toFixed(2)}, ${lat.toFixed(2)}`);
    check('zooming out stops at minZoom', clamp.zoom >= MAP.minZoom, clamp.zoom.toFixed(2));
  }
  check('basemap and data tiles are requested', tileRequests.length > 0, `${tileRequests.length} requests`);
  await page.click('.map-layercontrol button, .maplibregl-ctrl-group button[title*="apa"], .layer-control button').catch(() => {});
  await page.waitForTimeout(800);
  const radios = await page.locator('input[type=radio][name*="basemap"], .basemap-list input[type=radio]').count();
  if (radios) check(`basemap switcher offers ${BASEMAP_COUNT}`, radios === BASEMAP_COUNT, `${radios} options`);
  else skip('basemap switcher', 'no radio inputs found');

  // ---------- 7. Deep link ----------
  await open(route(COLLECTIONS[5].path), 3000);
  const before = await page.textContent('h1');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  check('a collection deep link reloads (id contains "/")', (await page.textContent('h1')) === before, before);
  check('search action hidden for a static catalog', await page.locator('.per-action[href*="search"]').count() === 0);
}

// ---------- 8. Mobile ----------
await page.setViewportSize(MOBILE);
const mobilePages = [['01-home', '']];
if (catalog) {
  const catastro = catalog.topics.find(t => t.title === 'Catastro') || catalog.topics[0];
  mobilePages.push(['03-topic-catastro', catastro.path.slice(catalogBase.length)]);
  for (const c of COLLECTIONS) mobilePages.push([`04-${c.key}`, c.path]);
}
for (const [name, path] of mobilePages) {
  await open(route(path), name === '01-home' ? 8000 : 4000);
  const m = await page.evaluate(() => ({
    header: document.querySelector('.per-header')?.getBoundingClientRect().height,
    logo: document.querySelector('.per-logo')?.getBoundingClientRect().width,
    demo: document.querySelector('.per-header .per-demo')?.getBoundingClientRect().height || 0,
  }));
  await noOverflow(`${name} mobile`);
  if (name === '01-home') {
    check('header renders on mobile', m.header > 0 && m.logo > 0, `${Math.round(m.header)}px high`);
    check('demo notice shows on mobile', m.demo > 0, `${Math.round(m.demo)}px high`);
    const layout = await page.evaluate(() => {
      const cols = sel => { const e = document.querySelector(sel); return e ? getComputedStyle(e).gridTemplateColumns.split(' ').length : null; };
      const copy = document.querySelector('.per-hero-copy')?.getBoundingClientRect();
      const map = document.querySelector('.per-hero-canvas')?.getBoundingClientRect();
      const views = document.querySelector('.per-hero-views')?.getBoundingClientRect();
      const credit = document.querySelector('.per-hero-credit')?.getBoundingClientRect();
      return { grid: cols('.per-grid'), featured: cols('.per-featured'), copyBottom: copy?.bottom, mapTop: map?.top, mapBottom: map?.bottom, viewsBottom: views?.bottom, creditTop: credit?.top };
    });
    check('layer grid is two columns on mobile', layout.grid === 2, `${layout.grid} columns`);
    if (layout.featured !== null) check('featured tiles stack on mobile', layout.featured === 1, `${layout.featured} columns`);
    if (homeConfig.hero) {
      check('the map sits under the hero text on mobile', layout.mapTop >= layout.copyBottom - 1, `${Math.round(layout.mapTop)} vs ${Math.round(layout.copyBottom)}`);
      check('map credits sit under the map, clear of the view buttons', layout.creditTop >= layout.mapBottom - 1 && layout.viewsBottom < layout.mapBottom, `${Math.round(layout.creditTop)} vs ${Math.round(layout.mapBottom)}`);
    }
  }
  await shoot(name, 'mobile');
}

// ---------- 9. Console ----------
const realErrors = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
check('no console errors', realErrors.length === 0, realErrors.slice(0, 4).join(' ;; ') || 'clean');

await browser.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${catalog ? '' : ' (catalog offline, data checks skipped)'}`);
if (catalogFindings.length) {
  console.log(`CATALOG FINDINGS (${catalogFindings.length}): ${catalogFindings.join(', ')}`);
}
if (failed.length) {
  console.log('FAILED:', failed.map(f => f.name).join(', '));
  process.exit(1);
}
