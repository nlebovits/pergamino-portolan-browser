import { Collection, STAC } from 'stac-js';

const BASEMAPS = {
  earth: [
    {
      url: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
      title: 'Voyager',
    },
    {
      url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      title: 'Positron',
    },
    {
      url: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      title: 'Dark Matter',
    },
    {
      url: 'https://cholmes.github.io/overture-pmtiles-styles/style-satellite.json',
      title: 'Satellite',
    },
  ],
//'earth-dark': [
//  {
//    url: 'https://cartodb-basemaps-{a-d}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png',
//    is: 'XYZ',
//    title: 'Carto Dark',
//    attributions: 'Map tiles by Carto, under CC BY 3.0. Data by OpenStreetMap, under ODbL.',
//    projection: "EPSG:3857"
//  }
//],
  europa: [
    {
      title: 'USGS Europa',
      raster: true,
      attribution: 'USGS Astrogeology',
      tiles: ['https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/jupiter/europa_simp_cyl.map&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=GALILEO_VOYAGER&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png'],
    },
  ],
  mars: [
    {
      title: 'USGS Mars',
      raster: true,
      attribution: 'USGS Astrogeology',
      tiles: ['https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/mars/mars_simp_cyl.map&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=MDIM21&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png'],
    },
  ],
  moon: [
    {
      title: 'USGS Moon',
      raster: true,
      attribution: 'USGS Astrogeology',
      tiles: ['https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/earth/moon_simp_cyl.map&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=LROC_WAC&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png'],
    },
  ],
};

/**
 * Portolan's basemaps are MapLibre GL style/raster definitions, not the
 * OpenLayers layers upstream configures here, so this takes only the STAC
 * object. Upstream's `i18n` and `store` arguments — the latter used to pick a
 * dark basemap variant from `store.state.colorMode` — arrive when the MapLibre
 * stack learns to follow the color mode.
 *
 * @param {Object} stac The STAC object
 * @returns {Array.<BasemapOptions>}
 */
export default function configureBasemap(stac) {
  let targets;
  if (stac instanceof Collection) {
    targets = stac.getSummary('ssys:targets');
  }
  if (stac instanceof STAC && !targets) {
    targets = stac.getMetadata('ssys:targets');
  }
  if (!targets) {
    targets = ['earth'];
  }

  let layers = [];
  for (const target of targets) {
    const maps = BASEMAPS[target.toLowerCase()];
    if (!Array.isArray(maps)) {
      continue;
    }
    layers = layers.concat(maps);
  }
  return layers;
}

/**
 * Bounds and zoom limits for every map in the IDE Pergamino browser. MapMixin
 * spreads them into the MapLibre constructor.
 *
 * Source: the bbox of the `limites/partido_pergamino` collection,
 * [-60.9440479, -34.176559, -60.138792, -33.5402169]. `maxBounds` pads that
 * bbox by its own width and height on each side, so the neighbouring areas in
 * `limites/localidades` stay on the map. `center` is the bbox midpoint.
 * `zoom` is the home view of the old viewer,
 * https://geonode.pergamino.gob.ar/visor/es#8.48/-33.861/-60.543.
 * `minZoom` and `maxZoom` are chosen, not sampled.
 */
export const MAP_CONSTRAINTS = {
  center: [-60.54, -33.86],
  zoom: 8.5,
  minZoom: 8,
  maxZoom: 19,
  maxBounds: [[-61.75, -34.82], [-59.33, -32.90]]
};
