// Verification for the IDE Pergamino browser.
//
// It drives a real browser against the running site and asserts what the
// approved design promises. The inherited tests/e2e suite asserts the upstream
// multi-catalog product, so it does not apply here.
//
// Expected values (topic counts, source chips, collection counts) come from the
// catalog at run time. When the catalog changes, the expectations follow.
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

/* global process, fetch, URL */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8080';
const OUT = process.env.VERIFY_OUT || './verify-out';
const CATALOG_URL = process.env.CATALOG_URL || 'https://data.source.coop/nlebovits/pergamino-ide/catalog.json';

// The approved tokens (src/theme/variables.scss), as the browser reports them.
const TOKENS = {
  ink: 'rgb(64, 64, 64)',          // $per-ink, #404040
  inkHover: 'rgb(90, 90, 90)',     // $per-ink-hover, #5a5a5a
  inkSoft: 'rgb(77, 77, 77)',      // $per-ink-soft, #4d4d4d
  footerInk: 'rgb(0, 0, 0)',       // $per-footer-ink, #000
  gradientStart: 'rgb(251, 205, 73)', // $per-gradient-start, #fbcd49
  gradientEnd: 'rgb(240, 127, 175)',  // $per-gradient-end, #f07faf
  pageBg: 'rgb(255, 255, 255)',
  font: /^"?Montserrat"?,\s*sans-serif$/,
};

// basemaps.config.js, MAP_CONSTRAINTS.
const MAP = { minZoom: 8, maxZoom: 19, maxBounds: [[-61.75, -34.82], [-59.33, -32.9]] };
const BASEMAP_COUNT = 4;
const TILE_HOSTS = /cartocdn\.com|cholmes\.github\.io|\.pmtiles/;

// src/utils/perHome.js
const MIN_SOURCE_COLLECTIONS = 5;

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
      collections.push(getJson(child).then(json => ({ url: child, json })));
    }
  }
  const loaded = await Promise.all(collections);
  const sources = new Map();
  for (const { json } of loaded) {
    const names = new Set((json.providers || []).filter(p => (p.roles || []).includes('producer')).map(p => p.name.trim()));
    for (const name of names) sources.set(name, (sources.get(name) || 0) + 1);
  }
  const chips = [...sources.entries()].filter(([, n]) => n >= MIN_SOURCE_COLLECTIONS)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'es'));
  return { root, topics, collections: loaded, chips };
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
  const bar = document.querySelector('.per-bar');
  const band = document.querySelector('.per-band');
  const action = document.querySelector('.per-action');
  const logo = document.querySelector('.per-logo');
  const footer = document.querySelector('#stac-browser > footer');
  const h1 = document.querySelector('h1');
  return {
    barBg: cs(bar)?.backgroundImage,
    bandBg: cs(band)?.backgroundColor,
    actionColor: cs(action)?.color,
    actionWeight: cs(action)?.fontWeight,
    actionLabel: action?.innerText.trim(),
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
    footerBg: cs(footer)?.backgroundImage,
    footerLinkColor: cs(footer?.querySelector('a'))?.color,
    footerLinks: [...(footer?.querySelectorAll('a') || [])].map(a => ({ text: a.innerText.trim(), href: a.href })),
  };
});
check('brand bar uses the GeoNode gradient', shell.barBg?.includes(TOKENS.gradientStart) && shell.barBg?.includes(TOKENS.gradientEnd), shell.barBg);
check('action band is #404040', shell.bandBg === TOKENS.ink, shell.bandBg);
check('action labels are white, weight 600', shell.actionColor === 'rgb(255, 255, 255)' && shell.actionWeight === '600', `${shell.actionColor} ${shell.actionWeight}`);
check('browse action reads "Categorías"', shell.actionLabel === 'Categorías', shell.actionLabel);
check('municipal logo loads', shell.logoLoaded && /pergamino\/logo-municipalidad-blanco\.svg$/.test(shell.logoSrc || ''), shell.logoSrc);
check('logo has alt text', shell.logoAlt === 'Municipalidad de Pergamino', shell.logoAlt);
check('wordmark reads the catalog title', shell.wordmark === 'IDE Pergamino', shell.wordmark);
check('document title follows the page', /IDE Pergamino/.test(shell.docTitle), shell.docTitle);
check('html lang is es', shell.lang === 'es', shell.lang);
check('favicon is the municipal icon', /pergamino\/favicon-32\.png$/.test(shell.favicon || ''), shell.favicon);
check('body font is Montserrat', TOKENS.font.test(shell.bodyFont || ''), shell.bodyFont);
check('heading font is Montserrat', TOKENS.font.test(shell.h1Font || ''), shell.h1Font);
check('body text is #404040', shell.bodyColor === TOKENS.ink, shell.bodyColor);
check('page background is white', shell.bodyBg === TOKENS.pageBg, shell.bodyBg);
check('h1 is #404040', shell.h1Color === TOKENS.ink, shell.h1Color);
check('footer uses the GeoNode gradient', shell.footerBg?.includes(TOKENS.gradientStart), shell.footerBg);
check('footer links are #000', shell.footerLinkColor === TOKENS.footerInk, shell.footerLinkColor);
const fl = shell.footerLinks;
const labels = fl.map(l => l.text).join(' | ');
check('footer links to the data', fl.some(l => l.href.includes('source.coop')), labels);
check('footer links to the publisher', fl.some(l => l.href.includes('geonode.pergamino.gob.ar')) && fl.some(l => l.href.includes('pergamino.ar/servicios/ide-pergamino')), labels);
check('footer links to the license', fl.some(l => l.href.includes('creativecommons.org/licenses/by-sa/4.0')), labels);
check('footer links to the source code', fl.some(l => l.href.includes('github.com')), labels);

// Hover state of the action band.
await page.hover('.per-action');
await page.waitForTimeout(300);
const hoverBg = await page.evaluate(() => getComputedStyle(document.querySelector('.per-action')).backgroundColor);
check('action band hover is #5a5a5a', hoverBg === TOKENS.inkHover, hoverBg);
await page.mouse.move(0, 600);

// Keyboard focus is visible.
await page.focus('.per-action');
await page.keyboard.press('Shift+Tab');
await page.keyboard.press('Tab');
const focus = await page.evaluate(() => { const a = document.activeElement; return a && getComputedStyle(a).outlineStyle + ' ' + getComputedStyle(a).outlineColor; });
check('action band focus ring is visible', /solid/.test(focus || ''), focus);

// ---------- 2. Home: topic grid ----------
if (catalog) {
  await page.waitForFunction(n => document.querySelectorAll('.per-topic:not(.loading)').length >= n, catalog.topics.length, { timeout: 30000 }).catch(() => {});
  const home = await page.evaluate(() => ({
    titles: [...document.querySelectorAll('.per-topic-title')].map(e => e.innerText.trim()),
    links: [...document.querySelectorAll('.per-topic')].map(e => [...e.querySelectorAll('a')].map(a => a.innerText.trim())),
    arrows: document.querySelectorAll('.per-topic-more svg.per-topic-arrow').length,
    titleLinks: document.querySelectorAll('.per-topic-title a').length,
    bullets: document.querySelectorAll('.per-topic ul').length,
    summary: document.querySelector('.per-summary')?.innerText.trim(),
    lead: document.querySelector('.per-lead')?.innerText.trim(),
    firstTop: document.querySelector('.per-topic')?.getBoundingClientRect().top,
    metaColumn: !!document.querySelector('.cc .meta'),
    stockGrid: !!document.querySelector('.catalogs-container'),
  }));
  const expectTitles = catalog.topics.map(t => t.title);
  check(`home shows ${expectTitles.length} topics in catalog order`, JSON.stringify(home.titles) === JSON.stringify(expectTitles), home.titles.join(', '));
  const expectLinks = catalog.topics.map(t => [t.count === 1 ? 'Ver la capa' : `Ver las ${t.count} capas`]);
  check('each card has one link that names the real count', JSON.stringify(home.links) === JSON.stringify(expectLinks), home.links.map(l => l.join(' + ')).join(', '));
  check('each card link carries an arrow', home.arrows === catalog.topics.length, `${home.arrows} arrows`);
  check('topic titles are not links', home.titleLinks === 0, `${home.titleLinks} linked titles`);
  check('topic cards have no bullet list', home.bullets === 0, `${home.bullets} lists`);
  const total = catalog.collections.length;
  check('summary line counts every collection', home.summary === `${total} capas en ${catalog.topics.length} categorías`, home.summary);
  check('lead sentence comes from the catalog description', !!home.lead && catalog.root.description.startsWith(home.lead.replace(/…$/, '')), home.lead);
  check('first topic card is above the fold', home.firstTop < DESKTOP.height, `${Math.round(home.firstTop)}px`);
  check('root description column is hidden', !home.metaColumn);
  check('stock grid is hidden without a filter', !home.stockGrid);
  await shoot('01-home', 'desktop');

  // Two clicks from home to a collection: the card link, then a collection card.
  await page.click('.per-topic-more');
  await page.waitForSelector('.catalog-card a', { timeout: 30000 }).catch(() => {});
  check('a card link opens its topic', page.url().endsWith(`#/${catalog.topics[0].path.slice(catalogBase.length)}`), page.url());
  await page.locator('.catalog-card a').first().click();
  await page.waitForSelector('.maplibregl-map', { timeout: 30000 }).catch(() => {});
  // Let the map finish before the next navigation. Upstream MapView throws
  // "reading 'isEmpty'" when a page is left while its assets still load.
  await page.waitForFunction(`(() => { const m = ${MAP_PROBE}; return !m || (m.isStyleLoaded() && m.areTilesLoaded()); })()`, null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3000);
  check('a collection card in the topic opens a collection', /collection\.json$/.test(page.url()), page.url());

  // ---------- 3. Home: source chips and the filtered state ----------
  await open(route(''), 1000);
  await page.waitForSelector('.per-chip', { timeout: 90000 }).catch(() => {});
  const chips = await page.evaluate(() => [...document.querySelectorAll('.per-chip:not(.per-chip-clear)')].map(b => b.innerText.replace(/\s+/g, ' ').trim()));
  const expectChips = catalog.chips.map(([name, n]) => `${name} ${n}`);
  check(`source chips list producers with ${MIN_SOURCE_COLLECTIONS}+ collections`, JSON.stringify(chips) === JSON.stringify(expectChips), chips.join(' | '));
  const target = catalog.chips.find(([name]) => /ARBA/.test(name)) || catalog.chips[catalog.chips.length - 1];
  if (target) {
    await page.locator('.per-chip', { hasText: target[0] }).click();
    await page.waitForTimeout(1500);
    const filtered = await page.evaluate(() => ({
      url: location.href,
      heading: document.querySelector('.catalogs > header h2')?.innerText.trim(),
      cards: document.querySelectorAll('.catalogs .catalog-card').length,
      topics: document.querySelectorAll('.per-topic').length,
      pressed: document.querySelector('.per-chip[aria-pressed="true"]')?.innerText.trim(),
    }));
    check('a chip puts the filter in the URL', filtered.url.includes('.fuente='), filtered.url);
    check('filtered grid names the source', filtered.heading === `Capas de ${target[0]}`, filtered.heading);
    check(`filtered grid lists ${target[1]} collections`, filtered.cards === target[1], `${filtered.cards} cards`);
    check('topic grid hides while filtered', filtered.topics === 0, `${filtered.topics} topic cards`);
    check('pressed chip is marked', !!filtered.pressed, filtered.pressed);
    const pressedStyle = await page.evaluate(() => { const b = document.querySelector('.per-chip[aria-pressed="true"]'); const s = b && getComputedStyle(b); return s && `${s.backgroundColor} ${s.color}`; });
    check('pressed chip is legible (white on #404040)', pressedStyle === `${TOKENS.ink} rgb(255, 255, 255)`, pressedStyle);
    await shoot('02-home-filtered', 'desktop');
    // A direct link reloads into the same filtered state.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(n => document.querySelectorAll('.catalogs .catalog-card').length >= n, target[1], { timeout: 90000 }).catch(() => {});
    const reloaded = await page.locator('.catalogs .catalog-card').count();
    check('filtered URL reloads to the same list', reloaded === target[1], `${reloaded} cards`);
    await page.locator('.per-chip-clear').click();
    await page.waitForTimeout(800);
    check('clearing the filter restores the topics', await page.locator('.per-topic').count() === catalog.topics.length);
  }
  else {
    skip('source filter', 'no producer reaches the minimum');
  }

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

  // ---------- 7. Sidebar and deep link ----------
  await open(route(''), 2000);
  await page.click('.per-action');
  await page.waitForSelector('#sidebar.show, #sidebar', { state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const sidebar = await page.evaluate(() => document.querySelector('#sidebar')?.innerText.slice(0, 200));
  check('"Categorías" opens the sidebar tree', !!sidebar && /Catastro/.test(sidebar), sidebar?.replace(/\s+/g, ' '));
  await page.keyboard.press('Escape');
  await open(route(COLLECTIONS[5].path), 3000);
  const before = await page.textContent('h1');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  check('a collection deep link reloads (id contains "/")', (await page.textContent('h1')) === before, before);
  check('search action hidden for a static catalog', await page.locator('.per-action[href*="search"]').count() === 0);
}

// ---------- 8. Mobile ----------
await page.setViewportSize(MOBILE);
const mobilePages = [['01-home', ''], ['02-home-filtered', catalog?.chips[0] ? `?.fuente=${encodeURIComponent((catalog.chips.find(([n]) => /ARBA/.test(n)) || catalog.chips[0])[0])}` : null]];
if (catalog) {
  const catastro = catalog.topics.find(t => t.title === 'Catastro') || catalog.topics[0];
  mobilePages.push(['03-topic-catastro', catastro.path.slice(catalogBase.length)]);
  for (const c of COLLECTIONS) mobilePages.push([`04-${c.key}`, c.path]);
}
for (const [name, path] of mobilePages) {
  if (path === null) continue;
  await open(route(path), name.startsWith('02') ? 15000 : 4000);
  const m = await page.evaluate(() => ({
    header: document.querySelector('.per-header')?.getBoundingClientRect().height,
    logo: document.querySelector('.per-logo')?.getBoundingClientRect().width,
  }));
  await noOverflow(`${name} mobile`);
  if (name === '01-home') {
    check('header renders on mobile', m.header > 0 && m.logo > 0, `${Math.round(m.header)}px high`);
    const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.per-topics') || document.body).gridTemplateColumns.split(' ').length);
    check('topic grid is one column on mobile', cols === 1, `${cols} columns`);
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
