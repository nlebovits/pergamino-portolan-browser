// The home view of the IDE Pergamino browser (src/components/PerHome.vue).
//
// The home view reads its categories, layers, sources and thumbnails from the
// catalog at run time. This file holds only what the catalog cannot say:
// which keyword marks a featured layer, where the QGIS plugin lives, and what
// the map at the top of the page shows.

export default {
  // A collection is featured when its STAC `keywords` contain this word.
  // Matching ignores case. Featured layers keep their catalog order.
  // Set to null to hide the "Destacadas" section.
  featuredKeyword: 'destacado',
  featuredLimit: 3,

  // The QGIS plugin that reads the Portolan registry.
  // The official site of the Municipalidad. The demo notice in the header
  // links it.
  officialSiteUrl: 'https://pergamino.ar/',

  // The source code of this browser. The header links it with the GitHub mark.
  sourceUrl: 'https://github.com/nlebovits/pergamino-portolan-browser',

  qgisPluginUrl: 'https://plugins.qgis.org/plugins/portolan_registry_qgis/',

  // The footer (src/components/PerFooter.vue), on every page. The contact
  // details and links of the Municipalidad come from the footer of
  // https://pergamino.ar/ in November 2026, without the emergency numbers.
  // The footer states that this site is a demo and not an official site.
  // A link with an `icon` (facebook, instagram, x, youtube, tiktok) shows the
  // brand mark of the network, with the label as its accessible name.
  footer: {
    contact: {
      address: 'Florida 629, Pergamino, Buenos Aires, Argentina',
      addressUrl: 'https://maps.app.goo.gl/71s7T84d9Le3j4Qm8',
      phone: '2477 328000',
      phoneUrl: 'tel:+542477328000',
      email: 'informes@pergamino.gob.ar'
    },
    columns: [
      {
        title: 'Datos',
        links: [
          { label: 'Datos en Source Cooperative', url: 'https://source.coop/nlebovits/pergamino-ide' },
          { label: 'Repositorio del catálogo', url: 'https://github.com/nlebovits/pergamino-ide-catalog' },
          { label: 'Complemento para QGIS', url: 'https://plugins.qgis.org/plugins/portolan_registry_qgis/' },
          { label: 'Visor GeoNode oficial', url: 'https://geonode.pergamino.gob.ar/visor/es' },
          { label: 'Licencia CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.es' }
        ]
      },
      {
        title: 'Municipalidad',
        links: [
          { label: 'pergamino.ar', url: 'https://pergamino.ar/' },
          { label: 'IDE Pergamino en pergamino.ar', url: 'https://pergamino.ar/servicios/ide-pergamino/' },
          { label: 'Pergamino al Día', url: 'https://pergaminoaldia.ar/' },
          { label: 'Portal Tributario', url: 'https://vppergamino.pergamino.ar/' },
          { label: 'Turismo', url: 'https://pergamino.tur.ar/' }
        ]
      },
      {
        title: 'Redes',
        links: [
          { label: 'Facebook', icon: 'facebook', url: 'https://www.facebook.com/munipergamino' },
          { label: 'Instagram', icon: 'instagram', url: 'https://www.instagram.com/munipergamino/' },
          { label: 'X', icon: 'x', url: 'https://x.com/MuniPergamino' },
          { label: 'YouTube', icon: 'youtube', url: 'https://www.youtube.com/@MUNICIPALIDADPERGAMINO' },
          { label: 'TikTok', icon: 'tiktok', url: 'https://www.tiktok.com/@munipergamino' }
        ]
      }
    ]
  },

  // The map at the top of the home page. Set to null to show no map. The
  // map opens on the camera of the first view and has no animation. The
  // visitor can drag it, but cannot zoom, rotate or tilt it.
  hero: {
    // The ground colour where no imagery covers the map.
    background: '#e4e0e6',

    // Imagery under the views, bottom first. An entry is one of:
    //
    // - A COG asset of a catalog collection: `collection` is its path below
    //   the root catalog, and `asset` is the asset key. The map reads only
    //   the tiles in view.
    // - Raster tiles: `tiles` is a list of XYZ URLs, with optional `bounds`,
    //   `minzoom` and `maxzoom`.
    imagery: [
      {
        // One RGB image of all 33 orthophoto mosaics, at 1 m in EPSG:3857.
        id: 'ortofotos',
        collection: 'imagenes/ortofotos_10cm_2022',
        asset: 'overview',
        attribution: 'Imagen: ortofotos 2022, Municipalidad de Pergamino'
      }
    ],

    // The first view opens the page. A second view adds a button for each.
    //
    // Each layer names a collection by its path below the root catalog. The
    // browser loads that collection and draws its PMTiles link. The other
    // keys of a layer are MapLibre layer properties (`type`, `filter`,
    // `paint`).
    //
    // `legend.colors` draws a colour ramp. `attribution` shows under the map.
    views: [
      {
        id: 'edificios',
        label: 'Edificios',
        camera: { center: [-60.5738, -33.8952], zoom: 16.5, pitch: 55, bearing: -30 },
        attribution: 'Edificios: Municipalidad de Pergamino y Google Research, Open Buildings 2023',
        layers: [
          {
            // `altura_promedio` is the mean height of the footprint in metres:
            // median 3 m, 52 m at most in the November 2026 data. A value of 0
            // has no height, so the map draws it as one storey of 3 m.
            collection: 'catastro/edificaciones_automaticas',
            type: 'fill-extrusion',
            paint: {
              'fill-extrusion-height': ['max', ['coalesce', ['get', 'altura_promedio'], 0], 3],
              'fill-extrusion-color': ['interpolate', ['linear'],
                ['max', ['coalesce', ['get', 'altura_promedio'], 0], 3],
                3, '#efe7dc', 6, '#f6dc8a', 12, '#fbcd49', 20, '#f59a8f', 30, '#f07faf', 52, '#c42a72'],
              'fill-extrusion-opacity': 0.95,
              'fill-extrusion-vertical-gradient': true
            }
          }
        ],
        // The legend counts pisos at 3 m each: 3 m is 1 piso, 52 m is 17.
        legend: {
          title: 'Altura de los edificios',
          colors: ['#efe7dc', '#f6dc8a', '#fbcd49', '#f59a8f', '#f07faf', '#c42a72'],
          min: '1 piso',
          max: '17 pisos'
        }
      }
    ]
  }
};
