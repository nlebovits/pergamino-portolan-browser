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

  // The map at the top of the home page. Set to null to show no map.
  hero: {
    // The ground colour where no imagery covers the map.
    background: '#e4e0e6',

    // Raster imagery under every view, bottom first. MapLibre requests a tile
    // only inside `bounds` and between `minzoom` and `maxzoom`. Outside the
    // bounds, the map shows `background`.
    imagery: [
      {
        id: 'conae',
        tiles: ['https://geotematico01.conae.gov.ar/geoserver/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
          + '&LAYER=Localidades:BuenosAires_Pergamino_2024&STYLE=raster&TILEMATRIXSET=EPSG:900913&FORMAT=image/jpeg'
          + '&TILEMATRIX=EPSG:900913:{z}&TILEROW={y}&TILECOL={x}'],
        bounds: [-60.6624, -33.9605, -60.4410, -33.8359],
        minzoom: 11,
        maxzoom: 18,
        attribution: 'Imagen: CONAE, Pleiades Neo 2024'
      }
    ],

    // One button per view, in this order. The first view opens the page.
    //
    // Each layer names a collection by its path below the root catalog. The
    // browser loads that collection and draws its PMTiles link. A view whose
    // collections fail to load still shows its imagery. The other keys of a
    // layer are MapLibre layer properties (`type`, `filter`, `paint`).
    //
    // `legend.colors` draws a colour ramp. `attribution` joins the imagery
    // credits under the map.
    views: [
      {
        id: 'edificios',
        label: 'Edificios',
        camera: { center: [-60.5738, -33.8952], zoom: 15.5, pitch: 62, bearing: -30 },
        imagery: { brightness: 0.95, saturation: -0.1 },
        attribution: 'Edificios: Catastro, Municipalidad de Pergamino',
        layers: [
          {
            // `clase` is "cubierto", "semicubierto" or "pileta". The map
            // leaves out pools. `alt-piso` is the storey height in metres.
            collection: 'catastro/edificaciones_pb',
            type: 'fill-extrusion',
            filter: ['!=', ['get', 'clase'], 'pileta'],
            paint: {
              'fill-extrusion-color': ['case', ['==', ['get', 'clase'], 'semicubierto'], '#cdc4ba',
                ['interpolate', ['linear'], ['coalesce', ['get', 'alt-piso'], 3], 3, '#efe7dc', 6, '#f6dc8a']],
              'fill-extrusion-height': ['min', ['max', ['coalesce', ['get', 'alt-piso'], 3], 3], 8],
              'fill-extrusion-opacity': 0.95,
              'fill-extrusion-vertical-gradient': true
            }
          },
          {
            // Upper floors start on the ground floor. Rooftop pools stay out. `pisos` counts the
            // storeys of this footprint and arrives as a string. The colour
            // follows the height of the top: 6 m for one storey, 39 m at most
            // in the November 2026 data.
            collection: 'catastro/edificaciones_pa',
            type: 'fill-extrusion',
            filter: ['!=', ['get', 'clase'], 'pileta'],
            paint: {
              'fill-extrusion-base': 3,
              'fill-extrusion-height': ['+', 3, ['*', ['to-number', ['get', 'pisos'], 1], ['coalesce', ['get', 'alt-piso'], 3]]],
              'fill-extrusion-color': ['interpolate', ['linear'],
                ['+', 3, ['*', ['to-number', ['get', 'pisos'], 1], ['coalesce', ['get', 'alt-piso'], 3]]],
                6, '#f6dc8a', 12, '#fbcd49', 20, '#f59a8f', 30, '#f07faf', 39, '#c42a72'],
              'fill-extrusion-opacity': 0.95,
              'fill-extrusion-vertical-gradient': true
            }
          }
        ],
        legend: {
          title: 'Altura de las construcciones',
          colors: ['#efe7dc', '#f6dc8a', '#fbcd49', '#f59a8f', '#f07faf', '#c42a72'],
          min: '3 m',
          max: '39 m',
          note: 'Pasá el cursor por un edificio'
        },
        tooltip: p => {
          if (p.pisos) {
            return { title: `${p.pisos} ${Number(p.pisos) === 1 ? 'piso' : 'pisos'} en planta alta`, text: p.barrio };
          }
          const kind = { cubierto: 'Construcción cubierta', semicubierto: 'Construcción semicubierta' };
          return { title: kind[p.clase] || 'Construcción', text: p.barrio };
        }
      },
      {
        id: 'satelite',
        label: 'Satélite',
        camera: { center: [-60.573, -33.893], zoom: 13.2, pitch: 0, bearing: 0 },
        imagery: { brightness: 1, saturation: 0 },
        layers: [
          {
            collection: 'limites/barrios',
            type: 'line',
            paint: { 'line-color': '#ffffff', 'line-width': 1.2, 'line-opacity': 0.85 }
          }
        ],
        legend: {
          title: 'Barrios de la ciudad',
          note: 'Sobre la imagen Pleiades Neo de 2024'
        },
        tooltip: null
      }
    ]
  }
};
