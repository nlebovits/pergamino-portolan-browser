// Helpers for the IDE Pergamino home view (PerHome.vue).
//
// The catalog nests root -> topic sub-catalogs -> collections. Collections
// carry no themes or keywords, so the home view reads its navigation from the
// catalog structure (the child links of each topic) and from the `providers`
// of each collection. Nothing here names a topic, a collection or a provider.
// When the catalog gains or loses a topic, a collection or a producer, the
// home view follows on the next page load.
//
// Every accessor returns an empty value for missing or malformed input, so a
// section without data does not render.

import { Link } from 'stac-js';

// A producer must hold at least this many collections to get a chip.
export const MIN_SOURCE_COLLECTIONS = 5;

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
 * Builds one card per root child that is a catalog (a topic).
 *
 * A topic that has not loaded yet still gets a card with its link title and
 * `loaded: false`, so the grid keeps its order while the topics load. A root
 * child that is itself a collection is not a topic and gets no card.
 *
 * @param {Array} children The root's child links.
 * @param {function} getStac Resolves a URL to a loaded stac-js object or null.
 * @returns {Array.<Object>} Topic cards: `{ link, url, title, description,
 *   loaded, layers, categories }`.
 */
export function topicCards(children, getStac) {
  if (!Array.isArray(children) || typeof getStac !== 'function') {
    return [];
  }
  const cards = [];
  for (const child of children) {
    const url = absoluteUrl(child);
    if (!url) {
      continue;
    }
    const stac = getStac(url);
    if (stac?.isCollection) {
      continue;
    }
    if (!stac && childKind(child, getStac) !== 'catalog') {
      continue;
    }
    const card = {
      link: child,
      url,
      title: stac?.title || child.title || '',
      description: typeof stac?.description === 'string' ? stac.description : '',
      loaded: Boolean(stac?.isCatalog),
      layers: 0,
      categories: 0
    };
    for (const link of childLinks(stac)) {
      const href = absoluteUrl(link);
      if (!href) {
        continue;
      }
      if (childKind(link, getStac) === 'catalog') {
        card.categories++;
      }
      else {
        card.layers++;
      }
    }
    cards.push(card);
  }
  return cards;
}

/**
 * Sums the topic cards into the home summary line.
 *
 * @param {Array} cards The output of `topicCards`.
 * @returns {{layers: number, categories: number, complete: boolean}} The
 *   collection count, the topic count, and whether every topic has loaded.
 */
export function catalogTotals(cards) {
  const totals = { layers: 0, categories: 0, complete: true };
  if (!Array.isArray(cards)) {
    return totals;
  }
  for (const card of cards) {
    totals.categories++;
    totals.layers += Number(card?.layers) || 0;
    if (!card?.loaded) {
      totals.complete = false;
    }
  }
  return totals;
}

/**
 * Expands the root's children one level into leaf entries.
 *
 * A loaded child catalog is replaced by its child links. Anything else (a
 * collection, or a child that has not loaded yet) stays a leaf. Only one level
 * is expanded. Grandchild links get an absolute href, so they resolve outside
 * their parent catalog.
 *
 * @param {Array} children The root's child links.
 * @param {function} getStac Resolves a URL to a loaded stac-js object or null.
 * @returns {Array.<{link: Object, url: ?string, stac: ?Object, expanded: boolean}>}
 */
export function expandChildren(children, getStac) {
  const leaves = [];
  if (!Array.isArray(children) || typeof getStac !== 'function') {
    return leaves;
  }
  for (const child of children) {
    if (!child) {
      continue;
    }
    const url = absoluteUrl(child);
    const stac = getStac(url ?? child);
    if (stac?.isCatalog && typeof stac.getStacLinksWithRel === 'function') {
      for (const link of stac.getStacLinksWithRel('child')) {
        const grandUrl = absoluteUrl(link);
        if (!grandUrl) {
          continue;
        }
        leaves.push({
          link: new Link({ href: grandUrl, rel: 'child', title: link.title, type: link.type }),
          url: grandUrl,
          stac: getStac(grandUrl),
          expanded: true
        });
      }
    }
    else {
      leaves.push({ link: child, url, stac, expanded: false });
    }
  }
  return leaves;
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

export function hasProducer(stac, name) {
  return Boolean(name) && producers(stac).includes(name);
}

/**
 * Counts the collections of each producer.
 *
 * @param {Array} collections Loaded collections.
 * @param {number} min The minimum count for a producer to be listed.
 * @returns {Array.<{name: string, count: number}>} Most collections first,
 *   then by name.
 */
export function sourceCounts(collections, min = MIN_SOURCE_COLLECTIONS) {
  if (!Array.isArray(collections)) {
    return [];
  }
  const counts = new Map();
  for (const stac of collections) {
    for (const name of producers(stac)) {
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= min)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, 'es'));
}

/**
 * The first sentence of a description, for the line under the page title.
 *
 * @param {string} text Plain text or Markdown.
 * @param {number} max The maximum length. A longer sentence is cut at a word.
 * @returns {string}
 */
export function leadSentence(text, max = 240) {
  if (typeof text !== 'string') {
    return '';
  }
  const plain = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) {
    return '';
  }
  const match = plain.match(/^.+?[.!?](?=\s|$)/);
  const sentence = match ? match[0] : plain;
  if (sentence.length <= max) {
    return sentence;
  }
  const cut = sentence.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[,;:]$/, '')}…`;
}
