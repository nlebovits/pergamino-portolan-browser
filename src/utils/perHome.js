// Helpers for the IDE Pergamino home view (PerHome.vue and PerHeroMap.vue).
//
// The home view reads its navigation from the catalog: each root child that is
// a catalog is a category, and the children of a category are its layers.
// Sources come from the `providers` of each collection, thumbnails from its
// preview assets, and featured layers from its `keywords`. Nothing here names a
// category, a collection or a provider, so new categories, new sources and new
// kinds of data (vector, raster, nested catalogs) show up on the next page load.
//
// Every accessor returns an empty value for missing or malformed input, so a
// section without data does not render.

import { Link } from 'stac-js';

function absoluteUrl(link) {
  if (link && typeof link.getAbsoluteUrl === 'function') {
    return link.getAbsoluteUrl() || null;
  }
  return null;
}

function childLinks(stac) {
  if (!stac || typeof stac.getStacLinksWithRel !== 'function') {
    return [];
  }
  return stac.getStacLinksWithRel('child');
}

/**
 * Tells if a child link points to a catalog or to a collection.
 *
 * A loaded child answers from its own type. An unloaded child falls back to
 * the STAC file name convention: `catalog.json` is a catalog, anything else
 * is a collection.
 *
 * @param {Object} link A stac-js Link.
 * @param {function} getStac Resolves a URL to a loaded stac-js object or null.
 * @returns {'catalog'|'collection'}
 */
export function childKind(link, getStac) {
  const url = absoluteUrl(link);
  const stac = url && typeof getStac === 'function' ? getStac(url) : null;
  if (stac?.isCollection) {
    return 'collection';
  }
  if (stac?.isCatalog) {
    return 'catalog';
  }
  const href = String(link?.href || url || '');
  return /(^|\/)catalog\.json$/i.test(href.split(/[?#]/)[0]) ? 'catalog' : 'collection';
}

/**
 * The names of the providers with the `producer` role, without duplicates.
 *
 * @param {Object} stac A collection.
 * @returns {Array.<string>}
 */
export function producers(stac) {
  if (!Array.isArray(stac?.providers)) {
    return [];
  }
  const names = [];
  for (const provider of stac.providers) {
    const name = typeof provider?.name === 'string' ? provider.name.trim() : '';
    if (name && Array.isArray(provider.roles) && provider.roles.includes('producer') && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

/**
 * The source of a layer: its first producer, else its first named provider.
 *
 * @param {Object} stac A loaded collection or catalog.
 * @returns {string} An empty string when the catalog names no provider.
 */
export function sourceOf(stac) {
  const [first] = producers(stac);
  if (first) {
    return first;
  }
  const named = Array.isArray(stac?.providers) ? stac.providers.find(p => typeof p?.name === 'string' && p.name.trim()) : null;
  return named ? named.name.trim() : '';
}

/**
 * The URL of the first thumbnail a browser can show, as the stock cards pick it.
 *
 * @param {Object} stac A loaded collection or catalog.
 * @returns {?string}
 */
export function thumbnailOf(stac) {
  if (!stac || typeof stac.getThumbnails !== 'function') {
    return null;
  }
  const [thumbnail] = stac.getThumbnails(true, 'thumbnail', true);
  return thumbnail ? absoluteUrl(thumbnail) : null;
}

function keywordsOf(stac) {
  const keywords = typeof stac?.getMetadata === 'function' ? stac.getMetadata('keywords') : null;
  return Array.isArray(keywords) ? keywords.filter(k => typeof k === 'string') : [];
}

// One layer tile. `stac` is null until the layer loads.
function entry(link, url, stac, group) {
  return {
    url,
    link,
    stac,
    loaded: Boolean(stac),
    isCatalog: childKind(link, () => stac) === 'catalog',
    title: stac?.title || link.title || '',
    description: typeof stac?.description === 'string' ? stac.description : '',
    source: sourceOf(stac),
    thumbnail: thumbnailOf(stac),
    keywords: keywordsOf(stac),
    groupKey: group.key,
    groupTitle: group.title
  };
}

/**
 * Groups the layers of the root catalog by category.
 *
 * Each root child that is a catalog becomes a category, and its children
 * become its layers. A category holds whatever its catalog links to:
 * collections of any kind, or nested catalogs. Root children that are
 * collections go into one last group with the key `null`, which the view names.
 * Child links get an absolute href, so they resolve outside their parent.
 *
 * @param {Array} children The root's child links.
 * @param {function} getStac Resolves a URL to a loaded stac-js object or null.
 * @returns {Array.<{key: ?string, link: ?Object, title: string, loaded: boolean, entries: Array}>}
 */
export function homeGroups(children, getStac) {
  if (!Array.isArray(children) || typeof getStac !== 'function') {
    return [];
  }
  const groups = [];
  const loose = { key: null, link: null, title: '', loaded: true, entries: [] };
  for (const child of children) {
    const url = absoluteUrl(child);
    if (!url) {
      continue;
    }
    const stac = getStac(url);
    if (childKind(child, getStac) === 'collection') {
      loose.entries.push(entry(child, url, stac, loose));
      continue;
    }
    const group = { key: url, link: child, title: stac?.title || child.title || '', loaded: Boolean(stac), entries: [] };
    for (const link of childLinks(stac)) {
      const href = absoluteUrl(link);
      if (href) {
        const absolute = new Link({ href, rel: 'child', title: link.title, type: link.type });
        group.entries.push(entry(absolute, href, getStac(href), group));
      }
    }
    groups.push(group);
  }
  if (loose.entries.length > 0) {
    groups.push(loose);
  }
  return groups;
}

/**
 * Every layer of every group, in catalog order.
 *
 * @param {Array} groups The output of `homeGroups`.
 * @returns {Array}
 */
export function allEntries(groups) {
  return Array.isArray(groups) ? groups.flatMap(group => group.entries) : [];
}

/**
 * The layers whose keywords contain the featured keyword, in catalog order.
 *
 * @param {Array} entries Layer entries.
 * @param {?string} keyword Matching ignores case. No keyword features nothing.
 * @param {number} limit The maximum number of layers.
 * @returns {Array}
 */
export function featuredEntries(entries, keyword, limit = 3) {
  if (!Array.isArray(entries) || typeof keyword !== 'string' || !keyword.trim()) {
    return [];
  }
  const wanted = keyword.trim().toLowerCase();
  return entries
    .filter(e => e.keywords.some(k => k.trim().toLowerCase() === wanted))
    .slice(0, Math.max(0, limit));
}

/**
 * Counts the layers of each source.
 *
 * @param {Array} entries Layer entries.
 * @returns {Array.<{name: string, count: number}>} Most layers first, then by name.
 */
export function sourceOptions(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const counts = new Map();
  for (const e of entries) {
    if (e.source) {
      counts.set(e.source, (counts.get(e.source) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, 'es'));
}

// Lower case without accents, so "catastro" finds "Catástro" and "educacion"
// finds "Educación".
export function fold(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Filters layers by source and by a free-text query.
 *
 * Every word of the query must appear in the title, description, source,
 * category or keywords of a layer. Matching ignores case and accents.
 *
 * @param {Array} entries Layer entries.
 * @param {{source: ?string, query: ?string}} filter
 * @returns {Array}
 */
export function filterEntries(entries, { source = null, query = '' } = {}) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const words = fold(query).split(/\s+/).filter(Boolean);
  return entries.filter(e => {
    if (source && e.source !== source) {
      return false;
    }
    if (words.length === 0) {
      return true;
    }
    const haystack = fold([e.title, e.description, e.source, e.groupTitle, ...e.keywords].join(' '));
    return words.every(word => haystack.includes(word));
  });
}

/**
 * The URL of a collection given by its path below the root catalog.
 *
 * @param {string} rootUrl The absolute URL of the root catalog.
 * @param {string} path For example `catastro/parcela`, or a path to a JSON file.
 * @returns {?string}
 */
export function collectionUrl(rootUrl, path) {
  if (typeof rootUrl !== 'string' || typeof path !== 'string' || !path.trim()) {
    return null;
  }
  const clean = path.trim().replace(/^\.?\//, '').replace(/\/$/, '');
  const file = /\.json$/i.test(clean) ? clean : `${clean}/collection.json`;
  try {
    return new URL(file, rootUrl).href;
  }
  catch {
    return null;
  }
}

/**
 * The PMTiles archive of a collection and its first vector layer.
 *
 * Portolan collections link the archive with `rel: "pmtiles"` and list its
 * layers in `pmtiles:layers`. An asset of type `application/vnd.pmtiles`
 * works too.
 *
 * @param {Object} stac A loaded collection.
 * @returns {?{url: string, layer: string}} Null when there is no archive or no layer name.
 */
export function pmtilesSource(stac) {
  if (!stac) {
    return null;
  }
  const candidates = [];
  if (typeof stac.getLinksWithRels === 'function') {
    candidates.push(...stac.getLinksWithRels(['pmtiles']));
  }
  if (typeof stac.getAssets === 'function') {
    candidates.push(...stac.getAssets().filter(a => a.type === 'application/vnd.pmtiles'));
  }
  for (const candidate of candidates) {
    const url = absoluteUrl(candidate);
    const layers = candidate['pmtiles:layers'];
    if (url && Array.isArray(layers) && typeof layers[0] === 'string') {
      return { url, layer: layers[0] };
    }
  }
  return null;
}
