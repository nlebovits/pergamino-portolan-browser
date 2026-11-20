<template>
  <div class="per-hero-map">
    <div ref="map" class="per-hero-canvas" />
    <div class="per-hero-veil" />
    <div v-if="views.length > 0" class="per-hero-controls">
      <div v-if="views.length > 1" class="per-hero-views" role="group" :aria-label="$t('pergamino.hero.views')">
        <button
          v-for="view in views" :key="view.id" type="button"
          :aria-pressed="view.id === active ? 'true' : 'false'" @click="show(view.id)"
        >
          {{ view.label }}
        </button>
      </div>
      <div v-if="legend" class="per-hero-legend">
        <strong>{{ legend.title }}</strong>
        <template v-if="Array.isArray(legend.colors) && legend.colors.length > 1">
          <span class="per-hero-ramp" :style="{ background: `linear-gradient(90deg, ${legend.colors.join(', ')})` }" />
          <span class="per-hero-ends"><span>{{ legend.min }}</span><span>{{ legend.max }}</span></span>
        </template>
        <span v-if="legend.note">{{ legend.note }}</span>
      </div>
    </div>
    <p v-if="credits" class="per-hero-credit">{{ credits }}</p>
  </div>
</template>

<script>
import { markRaw } from 'vue';
import { mapGetters } from 'vuex';
import maplibregl from 'maplibre-gl';
import { PMTiles } from 'pmtiles';
// Importing MapMixin registers the pmtiles:// protocol with MapLibre.
import { pmtilesProtocol } from './maps/MapMixin';
import { MAP_CONSTRAINTS } from '../../basemaps.config';
import { collectionUrl, pmtilesSource } from '../utils/perHome';
import { CachedSource } from '../utils/perTileCache';
import { cogLayerProps, loadDeckDeps } from './maps/StacMapLayer';
import { synthesizeRgbRender } from '../utils/renders';
import { Loading } from '../store/utils';

const IMAGERY_PREFIX = 'imagery-';
const IMAGERY_ANCHOR = 'imagery-anchor';

// One archive per URL for the life of the page, so that its directories stay
// in memory across visits to the home view.
const archives = new Map();

// The collection pages register their own archive for a URL. The hero
// registers its cached archive again each time it adds a source.
function useCachedArchive(url) {
  if (!archives.has(url)) {
    archives.set(url, new PMTiles(new CachedSource(url)));
  }
  pmtilesProtocol.add(archives.get(url));
}

// The map at the top of the home view. home.config.js defines its imagery and
// its views. Each view layer names a collection by its catalog path. This
// component loads the collection and draws its PMTiles archive, so the data
// itself always comes from the catalog.
export default {
  name: 'PerHeroMap',
  props: {
    config: {
      type: Object,
      required: true
    },
    rootUrl: {
      type: String,
      required: true
    }
  },
  data() {
    return {
      active: null
    };
  },
  computed: {
    ...mapGetters(['getStac']),
    views() {
      return Array.isArray(this.config.views) ? this.config.views.filter(view => view?.id) : [];
    },
    // Raster tiles (`tiles`), or a COG asset of a catalog collection
    // (`collection` and `asset`).
    imagery() {
      return Array.isArray(this.config.imagery)
        ? this.config.imagery.filter(i => i?.id && (Array.isArray(i.tiles) || (i.collection && i.asset)))
        : [];
    },
    rasterImagery() {
      return this.imagery.filter(i => Array.isArray(i.tiles));
    },
    cogImagery() {
      return this.imagery.filter(i => !Array.isArray(i.tiles));
    },
    activeView() {
      return this.views.find(view => view.id === this.active) || null;
    },
    legend() {
      return this.activeView?.legend || null;
    },
    // The top imagery first, then the data of every view.
    credits() {
      return [...this.imagery].reverse().map(i => i.attribution)
        .concat(this.views.map(view => view.attribution))
        .filter(Boolean).join(' · ');
    }
  },
  mounted() {
    // Non-reactive state. MapLibre objects must stay out of Vue's proxies.
    this.map = null;
    this.layerIds = {};
    this.collections = new Map();
    // Start the collection loads and the deck.gl download now. The map
    // style loads at the same time.
    for (const path of [...this.cogImagery.map(i => i.collection), ...this.viewPaths()]) {
      this.loadCollection(path);
    }
    this.deckDeps = this.cogImagery.length > 0 ? loadDeckDeps() : null;
    this.deckDeps?.catch(() => null);
    const first = this.views[0];
    this.active = first?.id || null;
    const sources = {};
    const layers = this.config.background
      ? [{ id: 'background', type: 'background', paint: { 'background-color': this.config.background } }]
      : [];
    for (const image of this.rasterImagery) {
      const id = IMAGERY_PREFIX + image.id;
      sources[id] = {
        type: 'raster', tiles: image.tiles, tileSize: image.tileSize || 256,
        ...(image.bounds ? { bounds: image.bounds } : {}),
        ...(image.minzoom !== undefined ? { minzoom: image.minzoom } : {}),
        ...(image.maxzoom !== undefined ? { maxzoom: image.maxzoom } : {})
      };
      layers.push({ id, type: 'raster', source: id, paint: { 'raster-fade-duration': 0 } });
    }
    // The COG imagery draws before this invisible layer, so the view layers
    // stay above it.
    layers.push({ id: IMAGERY_ANCHOR, type: 'background', paint: { 'background-opacity': 0 } });
    // The map opens on the camera of the first view. Only a drag moves it.
    this.map = markRaw(new maplibregl.Map({
      container: this.$refs.map,
      style: { version: 8, sources, layers },
      ...(first?.camera || {}),
      minZoom: MAP_CONSTRAINTS.minZoom,
      maxZoom: MAP_CONSTRAINTS.maxZoom,
      maxBounds: MAP_CONSTRAINTS.maxBounds,
      maxPitch: 75,
      scrollZoom: false,
      boxZoom: false,
      doubleClickZoom: false,
      dragRotate: false,
      keyboard: false,
      touchPitch: false,
      touchZoomRotate: false,
      attributionControl: false
    }));
    this.map.once('load', () => {
      this.addCogImagery();
      this.addViewLayers();
    });
  },
  beforeUnmount() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  },
  methods: {
    // One promise per path. The first call starts the load.
    loadCollection(path) {
      if (!this.collections.has(path)) {
        this.collections.set(path, this.fetchCollection(path));
      }
      return this.collections.get(path);
    },
    async fetchCollection(path) {
      const url = collectionUrl(this.rootUrl, path);
      if (!url) {
        return null;
      }
      if (!this.getStac(url)) {
        await this.$store.dispatch('load', { url, show: false }).catch(() => null);
      }
      // The store returns at once when another component already loads this
      // URL, such as the home view's loader. Wait for that load to end.
      if (this.$store.state.database[url] instanceof Loading) {
        await new Promise(resolve => {
          const stop = this.$store.watch(state => state.database[url], value => {
            if (!(value instanceof Loading)) {
              stop();
              resolve();
            }
          });
        });
      }
      return this.getStac(url);
    },
    // Draws each COG asset with deck.gl, inside the MapLibre style. The COG
    // reads only the overview level and the tiles the view needs.
    async addCogImagery() {
      if (this.cogImagery.length === 0) {
        return;
      }
      try {
        const deps = await this.deckDeps;
        const built = await Promise.all(this.cogImagery.map(async image => {
          const stac = await this.loadCollection(image.collection);
          const asset = typeof stac?.getAsset === 'function' ? stac.getAsset(image.asset) : null;
          const url = asset?.getAbsoluteUrl?.();
          if (!url) {
            return null;
          }
          const props = await cogLayerProps(
            { id: IMAGERY_PREFIX + image.id, url, render: synthesizeRgbRender(asset), opacity: 1 },
            deps.DecoderPool, deps.GeoTIFF
          );
          return new deps.COGLayer({ ...props, beforeId: IMAGERY_ANCHOR });
        }));
        const layers = built.filter(Boolean);
        if (!this.map || layers.length === 0) {
          return;
        }
        this.map.addControl(markRaw(new deps.MapboxOverlay({ interleaved: true, layers })));
      }
      catch (error) {
        // The map keeps its background and its data layers.
        console.warn('Failed to draw the hero imagery', error);
      }
    },
    viewPaths() {
      return [...new Set(this.views.flatMap(view => (view.layers || []).map(layer => layer.collection)))];
    },
    async addViewLayers() {
      const paths = this.viewPaths();
      const stacs = await Promise.all(paths.map(path => this.loadCollection(path)));
      if (!this.map) {
        return;
      }
      const sources = new Map(paths.map((path, i) => [path, pmtilesSource(stacs[i])]));
      for (const view of this.views) {
        this.layerIds[view.id] = [];
        (view.layers || []).forEach((layer, i) => {
          const archive = sources.get(layer.collection);
          if (!archive) {
            return;
          }
          const sourceId = `pmtiles-${archive.url}`;
          if (!this.map.getSource(sourceId)) {
            useCachedArchive(archive.url);
            this.map.addSource(sourceId, { type: 'vector', url: `pmtiles://${archive.url}` });
          }
          const style = { ...layer };
          delete style.collection;
          const id = `${view.id}-${i}`;
          this.map.addLayer({ ...style, id, source: sourceId, 'source-layer': archive.layer, layout: { ...style.layout, visibility: 'none' } });
          this.layerIds[view.id].push(id);
        });
      }
      this.show(this.active);
    },
    show(viewId) {
      const view = this.views.find(v => v.id === viewId);
      if (!view || !this.map) {
        return;
      }
      this.active = viewId;
      if (!this.layerIds[viewId]) {
        return; // addViewLayers() calls show() again when the layers exist.
      }
      for (const [id, ids] of Object.entries(this.layerIds)) {
        for (const layerId of ids) {
          this.map.setLayoutProperty(layerId, 'visibility', id === viewId ? 'visible' : 'none');
        }
      }
      const { brightness = 1, saturation = 0 } = view.imagery || {};
      // MapLibre raster paint applies to tile imagery only. A COG keeps its colours.
      for (const image of this.rasterImagery) {
        this.map.setPaintProperty(IMAGERY_PREFIX + image.id, 'raster-brightness-max', brightness);
        this.map.setPaintProperty(IMAGERY_PREFIX + image.id, 'raster-saturation', saturation);
      }
      this.map.jumpTo(view.camera || {});
    }
  }
};
</script>

<style lang="scss">
@import "maplibre-gl/dist/maplibre-gl.css";
@import 'bootstrap/scss/mixins';
@import "../theme/variables.scss";

// The map fills the hero section of PerHome. On a narrow screen, PerHome
// puts the map under the text, at a fixed height.
.per-hero-map {
  position: absolute;
  inset: 0;

  .per-hero-canvas {
    position: absolute;
    inset: 0;
  }

  // Keeps the text over the map legible with page colour on the left.
  .per-hero-veil {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background:
      linear-gradient(90deg, rgba($per-night, 0.93) 0%, rgba($per-night, 0.62) 34%, rgba($per-night, 0) 60%);
  }

  // On a narrow screen: the map at a fixed height, the view buttons at its
  // top, and the credits under it.
  @include media-breakpoint-down(md) {
    position: relative;

    .per-hero-canvas {
      position: relative;
      height: 380px;
    }

    .per-hero-veil,
    .per-hero-legend {
      display: none;
    }

    .per-hero-controls {
      top: 12px;
      bottom: auto;
    }

    .per-hero-credit {
      position: static;
      padding: 8px $per-gutter;
      border-radius: 0;
      background-color: transparent;
    }
  }
}

.per-hero-controls {
  position: absolute;
  right: $per-gutter;
  bottom: 30px;
  z-index: 2;
  display: grid;
  justify-items: end;
  gap: 10px;
}

.per-hero-views {
  display: flex;
  padding: 3px;
  border: 1px solid $per-line;
  border-radius: $per-radius;
  background-color: rgba($per-night, 0.88);
  backdrop-filter: blur(6px);

  button {
    padding: 7px 14px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: $per-muted;
    font-weight: $per-weight-label;
    font-size: 0.84rem;

    &[aria-pressed="true"] {
      background-color: $per-solid-bg;
      color: $per-solid-fg;
    }
  }
}

.per-hero-legend {
  display: grid;
  gap: 6px;
  max-width: 280px;
  padding: 10px 12px;
  border: 1px solid $per-line;
  border-radius: $per-radius;
  background-color: rgba($per-night, 0.88);
  backdrop-filter: blur(6px);
  color: $per-muted;
  font-size: 0.78rem;

  strong {
    color: $per-ink;
    font-weight: $per-weight-label;
  }
}

.per-hero-ramp {
  display: block;
  height: 8px;
  border-radius: 2px;
}

.per-hero-ends {
  display: flex;
  justify-content: space-between;
  font-family: $per-font-mono;
  font-variant-numeric: tabular-nums;
}


.per-hero-credit {
  position: absolute;
  left: $per-gutter;
  bottom: 8px;
  z-index: 2;
  margin: 0;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba($per-paper, 0.82);
  color: $per-muted;
  font-size: 0.7rem;
}
</style>
