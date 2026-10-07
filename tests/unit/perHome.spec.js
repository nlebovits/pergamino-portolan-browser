import { describe, it, expect } from 'vitest';
import { Catalog, Collection } from 'stac-js';
import {
  catalogTotals, childKind, expandChildren, hasProducer, leadSentence, producers, sourceCounts, topicCards,
  MIN_SOURCE_COLLECTIONS
} from '../../src/utils/perHome.js';

// A miniature of the IDE Pergamino catalog: root -> topic sub-catalogs ->
// collections, with ids that are POSIX paths like "catastro/parcela".
const BASE = 'https://example.com/pergamino/';

const collectionJson = (id, providers = []) => ({
  type: 'Collection', id, stac_version: '1.1.0', description: id, title: id,
  license: 'CC-BY-SA-4.0', extent: { spatial: { bbox: [[0, 0, 1, 1]] }, temporal: { interval: [[null, null]] } },
  providers,
  links: []
});
const catalogJson = (id, children, extra = {}) => ({
  type: 'Catalog', id, stac_version: '1.1.0', description: `${id} description`, ...extra,
  links: children.map(([href, title]) => ({ rel: 'child', href, title, type: 'application/json' }))
});
const producer = name => ({ name, roles: ['producer', 'licensor'] });
const host = { name: 'Source Cooperative', roles: ['host'] };

function makeCatalog() {
  const root = new Catalog(
    catalogJson('root', [
      ['./catastro/catalog.json', 'Catastro'],
      ['./salud/catalog.json', 'Salud'],
      ['./suelta/collection.json', 'Capa suelta']
    ]),
    `${BASE}catalog.json`
  );
  const catastro = new Catalog(
    catalogJson('catastro', [
      ['./parcela/collection.json', 'Parcelas'],
      ['./manzana/collection.json', 'Manzanas'],
      ['./chacra/collection.json', 'Chacras'],
      ['./quinta/collection.json', 'Quintas'],
      ['./zonas/collection.json', 'Zonas'],
      ['./historico/catalog.json', 'Histórico']
    ], { title: 'Catastro' }),
    `${BASE}catastro/catalog.json`
  );
  const parcela = new Collection(
    collectionJson('catastro/parcela', [producer('ARBA'), host]),
    `${BASE}catastro/parcela/collection.json`
  );
  const suelta = new Collection(collectionJson('suelta'), `${BASE}suelta/collection.json`);
  const database = {
    [`${BASE}catastro/catalog.json`]: catastro,
    [`${BASE}catastro/parcela/collection.json`]: parcela,
    [`${BASE}suelta/collection.json`]: suelta
  };
  const getStac = source => (typeof source === 'string' ? database[source] : null) ?? null;
  return { root, children: root.getStacLinksWithRel('child'), getStac, database };
}

describe('perHome', () => {
  describe('childKind', () => {
    const { children, getStac } = makeCatalog();

    it('uses the type of a loaded child', () => {
      expect(childKind(children[0], getStac)).toBe('catalog');
      expect(childKind(children[2], getStac)).toBe('collection');
    });

    it('falls back to the file name for an unloaded child', () => {
      expect(childKind(children[1], getStac)).toBe('catalog');
      expect(childKind({ href: './x/collection.json' }, () => null)).toBe('collection');
      expect(childKind({ href: './x/catalog.json?v=2' }, () => null)).toBe('catalog');
    });
  });

  describe('topicCards', () => {
    const { children, getStac } = makeCatalog();
    const cards = topicCards(children, getStac);

    it('makes one card per catalog child, in catalog order', () => {
      expect(cards.map(card => card.title)).toEqual(['Catastro', 'Salud']);
    });

    it('skips a root child that is a collection', () => {
      expect(cards.some(card => card.url.endsWith('suelta/collection.json'))).toBe(false);
    });

    it('counts collections and nested catalogs apart', () => {
      expect(cards[0].layers).toBe(5);
      expect(cards[0].categories).toBe(1);
    });

    it('reads the topic description', () => {
      expect(cards[0].description).toBe('catastro description');
    });

    it('keeps an unloaded topic as a card with its link title and no counts', () => {
      expect(cards[1]).toMatchObject({ title: 'Salud', loaded: false, layers: 0, categories: 0, description: '' });
    });

    it('follows a topic added to the catalog', () => {
      const root = new Catalog(
        catalogJson('root', [['./catastro/catalog.json', 'Catastro'], ['./nuevo/catalog.json', 'Nuevo tema']]),
        `${BASE}catalog.json`
      );
      const titles = topicCards(root.getStacLinksWithRel('child'), getStac).map(card => card.title);
      expect(titles).toEqual(['Catastro', 'Nuevo tema']);
    });

    it('returns no cards for missing input', () => {
      expect(topicCards(null, getStac)).toEqual([]);
      expect(topicCards(children, null)).toEqual([]);
      expect(topicCards([], getStac)).toEqual([]);
    });
  });

  describe('catalogTotals', () => {
    it('sums the collections and counts the topics', () => {
      expect(catalogTotals([{ layers: 20, loaded: true }, { layers: 7, loaded: true }]))
        .toEqual({ layers: 27, categories: 2, complete: true });
    });

    it('is incomplete while a topic loads', () => {
      expect(catalogTotals([{ layers: 20, loaded: true }, { layers: 0, loaded: false }]).complete).toBe(false);
    });

    it('returns zeros for missing input', () => {
      expect(catalogTotals(null)).toEqual({ layers: 0, categories: 0, complete: true });
      expect(catalogTotals([])).toEqual({ layers: 0, categories: 0, complete: true });
    });
  });

  describe('expandChildren', () => {
    const { children, getStac } = makeCatalog();
    const leaves = expandChildren(children, getStac);

    it('replaces a loaded topic with its children', () => {
      expect(leaves.filter(leaf => leaf.expanded).map(leaf => leaf.url)).toContain(`${BASE}catastro/parcela/collection.json`);
    });

    it('attaches the loaded STAC object to its leaf', () => {
      const leaf = leaves.find(entry => entry.url === `${BASE}catastro/parcela/collection.json`);
      expect(leaf.stac).toBeInstanceOf(Collection);
    });

    it('keeps an unloaded topic and a root collection as leaves', () => {
      const direct = leaves.filter(leaf => !leaf.expanded).map(leaf => leaf.url);
      expect(direct).toEqual([`${BASE}salud/catalog.json`, `${BASE}suelta/collection.json`]);
    });

    it('returns no leaves for missing input', () => {
      expect(expandChildren(undefined, getStac)).toEqual([]);
      expect(expandChildren(children, undefined)).toEqual([]);
    });
  });

  describe('producers', () => {
    it('reads the providers with the producer role', () => {
      expect(producers({ providers: [producer('INTA'), host, { name: 'Municipalidad', roles: ['processor'] }] }))
        .toEqual(['INTA']);
    });

    it('removes duplicates and blank names', () => {
      expect(producers({ providers: [producer('INTA'), producer(' INTA '), producer('')] })).toEqual(['INTA']);
    });

    it('returns nothing without providers', () => {
      expect(producers({})).toEqual([]);
      expect(producers(null)).toEqual([]);
      expect(producers({ providers: 'INTA' })).toEqual([]);
      expect(producers({ providers: [{ name: 'X' }] })).toEqual([]);
    });

    it('matches a producer by name', () => {
      expect(hasProducer({ providers: [producer('ARBA')] }, 'ARBA')).toBe(true);
      expect(hasProducer({ providers: [producer('ARBA')] }, 'INTA')).toBe(false);
      expect(hasProducer({ providers: [producer('ARBA')] }, null)).toBe(false);
    });
  });

  describe('sourceCounts', () => {
    const many = (name, count) => Array.from({ length: count }, () => ({ providers: [producer(name)] }));

    it('lists the producers at or above the minimum, most collections first', () => {
      const collections = [...many('INTA', 11), ...many('ARBA', 11), ...many('INDEC', 7), ...many('IGN', 1)];
      expect(sourceCounts(collections)).toEqual([
        { name: 'ARBA', count: 11 },
        { name: 'INTA', count: 11 },
        { name: 'INDEC', count: 7 }
      ]);
    });

    it('uses the default minimum', () => {
      expect(sourceCounts(many('X', MIN_SOURCE_COLLECTIONS - 1))).toEqual([]);
      expect(sourceCounts(many('X', MIN_SOURCE_COLLECTIONS))).toEqual([{ name: 'X', count: MIN_SOURCE_COLLECTIONS }]);
    });

    it('lists a new producer once it reaches the minimum', () => {
      expect(sourceCounts(many('Nuevo', 2), 2)).toEqual([{ name: 'Nuevo', count: 2 }]);
    });

    it('returns nothing for missing input', () => {
      expect(sourceCounts(null)).toEqual([]);
      expect(sourceCounts([null, {}, { providers: [] }])).toEqual([]);
    });
  });

  describe('leadSentence', () => {
    it('returns the first sentence', () => {
      expect(leadSentence('Espejo cloud-native de la IDE. Los datos son publicados por la DSIG.'))
        .toBe('Espejo cloud-native de la IDE.');
    });

    it('removes Markdown links and emphasis', () => {
      expect(leadSentence('Datos de [la DSIG](https://example.com) en **GeoParquet**. Resto.'))
        .toBe('Datos de la DSIG en GeoParquet.');
    });

    it('cuts a long sentence at a word', () => {
      const out = leadSentence('palabra '.repeat(60), 40);
      expect(out.length).toBeLessThanOrEqual(41);
      expect(out.endsWith('…')).toBe(true);
    });

    it('returns an empty string without a description', () => {
      expect(leadSentence(undefined)).toBe('');
      expect(leadSentence('   ')).toBe('');
    });
  });
});
