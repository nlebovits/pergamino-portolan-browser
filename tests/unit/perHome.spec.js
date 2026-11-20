import { describe, it, expect } from 'vitest';
import { Catalog, Collection } from 'stac-js';
import {
  allEntries, childKind, collectionUrl, featuredEntries, filterEntries, fold, homeGroups,
  parquetSource, pmtilesSource, producers, querySnippets, sourceOf, sourceOptions, thumbnailOf
} from '../../src/utils/perHome.js';

// A miniature of the IDE Pergamino catalog: root -> category sub-catalogs ->
// collections, with ids that are POSIX paths like "catastro/parcela".
const BASE = 'https://example.com/pergamino/';

const collectionJson = (id, { title = id, description = id, providers = [], keywords, assets = {}, links = [] } = {}) => ({
  type: 'Collection', id, stac_version: '1.1.0', description, title,
  license: 'CC-BY-SA-4.0', extent: { spatial: { bbox: [[0, 0, 1, 1]] }, temporal: { interval: [[null, null]] } },
  providers, assets, links,
  ...(keywords ? { keywords } : {})
});
const catalogJson = (id, children, extra = {}) => ({
  type: 'Catalog', id, stac_version: '1.1.0', description: `${id} description`, ...extra,
  links: children.map(([href, title]) => ({ rel: 'child', href, title, type: 'application/json' }))
});
const producer = name => ({ name, roles: ['producer', 'licensor'] });
const host = { name: 'Source Cooperative', roles: ['host'] };
const thumbnail = { thumbnail: { href: './thumbnail.png', type: 'image/png', roles: ['thumbnail'] } };

function makeCatalog() {
  const root = new Catalog(
    catalogJson('root', [
      ['./catastro/catalog.json', 'Catastro'],
      ['./salud/catalog.json', 'Salud'],
      ['./imagenes/catalog.json', 'Imágenes'],
      ['./suelta/collection.json', 'Capa suelta']
    ]),
    `${BASE}catalog.json`
  );
  const catastro = new Catalog(
    catalogJson('catastro', [
      ['./parcela/collection.json', 'Parcelas'],
      ['./manzana/collection.json', 'Manzanas'],
      ['./historico/catalog.json', 'Histórico']
    ], { title: 'Catastro' }),
    `${BASE}catastro/catalog.json`
  );
  // A raster category from another producer, to show that nothing assumes
  // vector data or one source.
  const imagenes = new Catalog(
    catalogJson('imagenes', [['./pleiades/collection.json', 'Pleiades']], { title: 'Imágenes' }),
    `${BASE}imagenes/catalog.json`
  );
  const parcela = new Collection(
    collectionJson('catastro/parcela', {
      title: 'Parcelas', description: 'Parcelas urbanas y rurales del partido.',
      providers: [host, producer('ARBA')], keywords: ['catastro', 'Destacado'], assets: thumbnail,
      links: [{ rel: 'pmtiles', href: './parcela.pmtiles', type: 'application/vnd.pmtiles', 'pmtiles:layers': ['publico_parcela'] }]
    }),
    `${BASE}catastro/parcela/collection.json`
  );
  const pleiades = new Collection(
    collectionJson('imagenes/pleiades', {
      title: 'Imagen Pleiades Neo 2024', providers: [producer('CONAE')], keywords: ['destacado', 'satélite'],
      assets: { cog: { href: './pleiades.tif', type: 'image/tiff; application=geotiff; profile=cloud-optimized', roles: ['data'] } }
    }),
    `${BASE}imagenes/pleiades/collection.json`
  );
  const suelta = new Collection(
    collectionJson('suelta', { title: 'Educación', providers: [{ name: 'Municipalidad', roles: ['processor'] }] }),
    `${BASE}suelta/collection.json`
  );
  const database = {
    [`${BASE}catastro/catalog.json`]: catastro,
    [`${BASE}imagenes/catalog.json`]: imagenes,
    [`${BASE}catastro/parcela/collection.json`]: parcela,
    [`${BASE}imagenes/pleiades/collection.json`]: pleiades,
    [`${BASE}suelta/collection.json`]: suelta
  };
  const getStac = source => (typeof source === 'string' ? database[source] : null) ?? null;
  return { root, children: root.getStacLinksWithRel('child'), getStac, database, parcela, pleiades };
}

describe('perHome', () => {
  describe('childKind', () => {
    const { children, getStac } = makeCatalog();

    it('uses the type of a loaded child', () => {
      expect(childKind(children[0], getStac)).toBe('catalog');
      expect(childKind(children[3], getStac)).toBe('collection');
    });

    it('falls back to the file name for an unloaded child', () => {
      expect(childKind(children[1], getStac)).toBe('catalog');
      expect(childKind({ href: './x/collection.json' }, () => null)).toBe('collection');
      expect(childKind({ href: './x/catalog.json?v=2' }, () => null)).toBe('catalog');
    });
  });

  describe('homeGroups', () => {
    const { children, getStac } = makeCatalog();
    const groups = homeGroups(children, getStac);

    it('makes one group per catalog child, in catalog order, and puts root collections last', () => {
      expect(groups.map(g => g.key)).toEqual([
        `${BASE}catastro/catalog.json`, `${BASE}salud/catalog.json`, `${BASE}imagenes/catalog.json`, null
      ]);
      expect(groups.map(g => g.title)).toEqual(['Catastro', 'Salud', 'Imágenes', '']);
    });

    it('lists the children of a loaded category, collections and nested catalogs alike', () => {
      expect(groups[0].entries.map(e => e.url)).toEqual([
        `${BASE}catastro/parcela/collection.json`,
        `${BASE}catastro/manzana/collection.json`,
        `${BASE}catastro/historico/catalog.json`
      ]);
      expect(groups[0].entries.map(e => e.isCatalog)).toEqual([false, false, true]);
    });

    it('gives each entry an absolute link, so it resolves outside its category', () => {
      expect(groups[0].entries[0].link.getAbsoluteUrl()).toBe(`${BASE}catastro/parcela/collection.json`);
    });

    it('reads a loaded layer from the catalog', () => {
      expect(groups[0].entries[0]).toMatchObject({
        loaded: true, title: 'Parcelas', source: 'ARBA', groupTitle: 'Catastro',
        thumbnail: `${BASE}catastro/parcela/thumbnail.png`, keywords: ['catastro', 'Destacado']
      });
    });

    it('keeps an unloaded layer with its link title', () => {
      expect(groups[0].entries[1]).toMatchObject({ loaded: false, title: 'Manzanas', source: '', thumbnail: null, keywords: [] });
    });

    it('keeps an unloaded category with no entries', () => {
      expect(groups[1]).toMatchObject({ loaded: false, title: 'Salud', entries: [] });
    });

    it('takes a category of another kind of data from another source', () => {
      expect(groups[2].entries[0]).toMatchObject({ title: 'Imagen Pleiades Neo 2024', source: 'CONAE', thumbnail: null });
    });

    it('follows a category added to the catalog', () => {
      const root = new Catalog(
        catalogJson('root', [['./catastro/catalog.json', 'Catastro'], ['./nuevo/catalog.json', 'Nuevo tema']]),
        `${BASE}catalog.json`
      );
      expect(homeGroups(root.getStacLinksWithRel('child'), getStac).map(g => g.title)).toEqual(['Catastro', 'Nuevo tema']);
    });

    it('returns no groups for missing input', () => {
      expect(homeGroups(null, getStac)).toEqual([]);
      expect(homeGroups(children, null)).toEqual([]);
      expect(homeGroups([], getStac)).toEqual([]);
    });

    it('flattens the groups in catalog order', () => {
      expect(allEntries(groups).map(e => e.title)).toEqual(['Parcelas', 'Manzanas', 'Histórico', 'Imagen Pleiades Neo 2024', 'Educación']);
      expect(allEntries(null)).toEqual([]);
    });
  });

  describe('producers and sourceOf', () => {
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
    });

    it('prefers a producer, then any named provider', () => {
      expect(sourceOf({ providers: [host, producer('ARBA')] })).toBe('ARBA');
      expect(sourceOf({ providers: [{ name: ' DSIG ', roles: ['processor'] }] })).toBe('DSIG');
      expect(sourceOf({ providers: [{ roles: ['host'] }] })).toBe('');
      expect(sourceOf(null)).toBe('');
    });
  });

  describe('thumbnailOf', () => {
    it('returns the absolute URL of a thumbnail asset', () => {
      const { parcela } = makeCatalog();
      expect(thumbnailOf(parcela)).toBe(`${BASE}catastro/parcela/thumbnail.png`);
    });

    it('returns null without a thumbnail', () => {
      const { pleiades } = makeCatalog();
      expect(thumbnailOf(pleiades)).toBeNull();
      expect(thumbnailOf(null)).toBeNull();
    });
  });

  describe('featuredEntries', () => {
    const { children, getStac } = makeCatalog();
    const entries = allEntries(homeGroups(children, getStac));

    it('keeps the layers with the keyword in catalog order, ignoring case', () => {
      expect(featuredEntries(entries, 'destacado').map(e => e.title)).toEqual(['Parcelas', 'Imagen Pleiades Neo 2024']);
      expect(featuredEntries(entries, ' DESTACADO ').length).toBe(2);
    });

    it('stops at the limit', () => {
      expect(featuredEntries(entries, 'destacado', 1).map(e => e.title)).toEqual(['Parcelas']);
    });

    it('features nothing without a keyword or a match', () => {
      expect(featuredEntries(entries, null)).toEqual([]);
      expect(featuredEntries(entries, '')).toEqual([]);
      expect(featuredEntries(entries, 'portada')).toEqual([]);
      expect(featuredEntries(null, 'destacado')).toEqual([]);
    });
  });

  describe('sourceOptions', () => {
    const named = (...sources) => sources.map(source => ({ source }));

    it('counts the layers of each source, most layers first, then by name', () => {
      expect(sourceOptions(named('INTA', 'ARBA', 'INTA', 'CONAE', 'ARBA', ''))).toEqual([
        { name: 'ARBA', count: 2 }, { name: 'INTA', count: 2 }, { name: 'CONAE', count: 1 }
      ]);
    });

    it('returns nothing for missing input', () => {
      expect(sourceOptions(null)).toEqual([]);
      expect(sourceOptions(named(''))).toEqual([]);
    });
  });

  describe('filterEntries', () => {
    const { children, getStac } = makeCatalog();
    const entries = allEntries(homeGroups(children, getStac));
    const titles = list => list.map(e => e.title);

    it('returns every layer without a filter', () => {
      expect(filterEntries(entries)).toHaveLength(entries.length);
    });

    it('filters by source', () => {
      expect(titles(filterEntries(entries, { source: 'CONAE' }))).toEqual(['Imagen Pleiades Neo 2024']);
    });

    it('matches every word of the query, ignoring case and accents', () => {
      expect(titles(filterEntries(entries, { query: 'educacion' }))).toEqual(['Educación']);
      expect(titles(filterEntries(entries, { query: 'SATELITE pleiades' }))).toEqual(['Imagen Pleiades Neo 2024']);
      expect(titles(filterEntries(entries, { query: 'pleiades parcelas' }))).toEqual([]);
    });

    it('searches the description, the source and the category', () => {
      expect(titles(filterEntries(entries, { query: 'rurales' }))).toEqual(['Parcelas']);
      expect(titles(filterEntries(entries, { query: 'arba' }))).toEqual(['Parcelas']);
      expect(titles(filterEntries(entries, { query: 'imagenes' }))).toEqual(['Imagen Pleiades Neo 2024']);
    });

    it('combines the source and the query', () => {
      expect(filterEntries(entries, { source: 'ARBA', query: 'pleiades' })).toEqual([]);
    });

    it('returns nothing for missing input', () => {
      expect(filterEntries(null, { query: 'x' })).toEqual([]);
    });

    it('folds accents and case', () => {
      expect(fold('Educación ÁREA')).toBe('educacion area');
      expect(fold(null)).toBe('');
    });
  });

  describe('collectionUrl', () => {
    it('resolves a collection path against the root catalog', () => {
      expect(collectionUrl(`${BASE}catalog.json`, 'catastro/parcela')).toBe(`${BASE}catastro/parcela/collection.json`);
      expect(collectionUrl(`${BASE}catalog.json`, './catastro/parcela/')).toBe(`${BASE}catastro/parcela/collection.json`);
    });

    it('keeps a path that names a JSON file', () => {
      expect(collectionUrl(`${BASE}catalog.json`, 'imagenes/catalog.json')).toBe(`${BASE}imagenes/catalog.json`);
    });

    it('returns null for missing input', () => {
      expect(collectionUrl(null, 'x')).toBeNull();
      expect(collectionUrl(`${BASE}catalog.json`, '')).toBeNull();
      expect(collectionUrl('not a url', 'x')).toBeNull();
    });
  });

  describe('pmtilesSource', () => {
    it('reads the archive and its first layer from the pmtiles link', () => {
      const { parcela } = makeCatalog();
      expect(pmtilesSource(parcela)).toEqual({ url: `${BASE}catastro/parcela/parcela.pmtiles`, layer: 'publico_parcela' });
    });

    it('reads a PMTiles asset', () => {
      const stac = new Collection(
        collectionJson('x', { assets: { tiles: { href: './x.pmtiles', type: 'application/vnd.pmtiles', 'pmtiles:layers': ['x'] } } }),
        `${BASE}x/collection.json`
      );
      expect(pmtilesSource(stac)).toEqual({ url: `${BASE}x/x.pmtiles`, layer: 'x' });
    });

    it('returns null without an archive or a layer name', () => {
      const { pleiades } = makeCatalog();
      expect(pmtilesSource(pleiades)).toBeNull();
      const unnamed = new Collection(
        collectionJson('y', { links: [{ rel: 'pmtiles', href: './y.pmtiles' }] }),
        `${BASE}y/collection.json`
      );
      expect(pmtilesSource(unnamed)).toBeNull();
      expect(pmtilesSource(null)).toBeNull();
    });
  });
  describe('parquetSource', () => {
    const layer = (assets, extra = {}) => new Collection(
      { ...collectionJson('x', { assets }), ...extra },
      `${BASE}x/collection.json`
    );

    it('reads the GeoParquet data asset of a spatial layer', () => {
      const stac = layer({
        tiles: { href: './x.pmtiles', type: 'application/vnd.pmtiles', roles: ['data'] },
        data: { href: './x.parquet', type: 'application/vnd.apache.parquet', roles: ['data'] }
      }, { 'table:primary_geometry': 'geometry' });
      expect(parquetSource(stac)).toEqual({ url: `${BASE}x/x.parquet`, spatial: true });
    });

    it('marks a table without a primary geometry as not spatial', () => {
      const stac = layer({ data: { href: './t.parquet', type: 'application/vnd.apache.parquet', roles: ['data'] } });
      expect(parquetSource(stac)).toEqual({ url: `${BASE}x/t.parquet`, spatial: false });
    });

    it('prefers the data role and accepts a media type parameter or a bare .parquet href', () => {
      const stac = layer({
        sample: { href: './sample.parquet', type: 'application/vnd.apache.parquet; profile=sample', roles: ['metadata'] },
        data: { href: './full.parquet', roles: ['data'] }
      });
      expect(parquetSource(stac).url).toBe(`${BASE}x/full.parquet`);
    });

    it('accepts a Parquet asset without roles', () => {
      const stac = layer({ table: { href: './t.parquet', type: 'application/vnd.apache.parquet' } });
      expect(parquetSource(stac).url).toBe(`${BASE}x/t.parquet`);
    });

    // An Overture collection links one Overture part, which covers much more
    // than the partido. The orthophotos link their STAC items as Parquet.
    it('skips external data and Parquet files with other roles', () => {
      const overture = layer({
        data: {
          href: 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/2026-10-21.0/theme=places/type=place/part-00004.zstd.parquet',
          type: 'application/vnd.apache.parquet', roles: ['data', 'external']
        },
        visual: { href: 'https://example.org/places.pmtiles', type: 'application/vnd.pmtiles', roles: ['visual', 'external'] }
      });
      expect(parquetSource(overture)).toBeNull();
      const orthophotos = layer({
        items: { href: './items.parquet', type: 'application/vnd.apache.parquet', roles: ['collection-mirror'] },
        escenas: { href: './escenas.parquet', type: 'application/vnd.apache.parquet', roles: ['metadata'] },
        'version-2026-08-14': { href: './old.parquet', type: 'application/vnd.apache.parquet', roles: ['archive'] }
      });
      expect(parquetSource(orthophotos)).toBeNull();
    });

    it('returns null for a raster layer or missing input', () => {
      const { pleiades } = makeCatalog();
      expect(parquetSource(pleiades)).toBeNull();
      expect(parquetSource(null)).toBeNull();
    });
  });

  describe('querySnippets', () => {
    const url = 'https://example.com/x.parquet';

    it('uses GeoPandas and the spatial extension for a spatial layer', () => {
      const { python, duckdb } = querySnippets({ url, spatial: true });
      expect(python).toContain('import geopandas as gpd');
      expect(python).toContain(`url = "${url}"`);
      expect(python).toContain('gpd.read_parquet(url)');
      expect(duckdb).toBe(`INSTALL spatial;\nLOAD spatial;\n\nSELECT *\nFROM '${url}'\nLIMIT 10;`);
    });

    it('uses pandas and plain SQL for a table', () => {
      const { python, duckdb } = querySnippets({ url, spatial: false });
      expect(python).toContain('pd.read_parquet(url)');
      expect(python).not.toContain('geopandas');
      expect(duckdb).toBe(`SELECT *\nFROM '${url}'\nLIMIT 10;`);
    });

    it('returns null without a file', () => {
      expect(querySnippets(null)).toBeNull();
    });
  });
});
