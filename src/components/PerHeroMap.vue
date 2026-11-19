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
        <span v-if="legend.note"><i v-if="legend.swatch" class="per-hero-swatch" :style="{ background: legend.swatch }" />{{ legend.note }}</span>
      </div>
    </div>
    <p v-if="credits" class="per-hero-credit">{{ credits }}</p>
    <div ref="tip" class="per-hero-tip" hidden>
      <strong ref="tipTitle" /><span ref="tipText" />
    </div>
  </div>
</template>

<script>
import { markRaw } from 'vue';
import { mapGetters } from 'vuex';
import maplibregl from 'maplibre-gl';
// Importing MapMixin registers the pmtiles:// protocol with MapLibre.
import './maps/MapMixin';
import { MAP_CONSTRAINTS } from '../../basemaps.config';
import { collectionUrl, pmtilesSource } from '../utils/perHome';

const GROW_MS = 1800;
const IMAGERY_PREFIX = 'imagery-';

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
    imagery() {
      return Array.isArray(this.config.imagery) ? this.config.imagery.filter(i => i?.id && Array.isArray(i.tiles)) : [];
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
    },
    reducedMotion() {
      return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    }
  },
  mounted() {
    // Non-reactive state. MapLibre objects must stay out of Vue's proxies.
    this.map = null;
    this.layerIds = {};
    this.grown = new Set();
    const first = this.views[0];
    this.active = first?.id || null;
    const sources = {};
    const layers = this.config.background
      ? [{ id: 'background', type: 'background', paint: { 'background-color': this.config.background } }]
      : [];
    for (const image of this.imagery) {
      const id = IMAGERY_PREFIX + image.id;
      sources[id] = {
        type: 'raster', tiles: image.tiles, tileSize: image.tileSize || 256,
        ...(image.bounds ? { bounds: image.bounds } : {}),
        ...(image.minzoom !== undefined ? { minzoom: image.minzoom } : {}),
        ...(image.maxzoom !== undefined ? { maxzoom: image.maxzoom } : {})
      };
      layers.push({ id, type: 'raster', source: id, paint: { 'raster-fade-duration': 0 } });
    }
    // The page opens on the first view seen from straight above, then tilts.
    const camera = first?.camera || {};
    this.map = markRaw(new maplibregl.Map({
      container: this.$refs.map,
      style: { version: 8, sources, layers },
      ...camera,
      pitch: 0,
      bearing: 0,
      minZoom: MAP_CONSTRAINTS.minZoom,
      maxZoom: MAP_CONSTRAINTS.maxZoom,
      maxBounds: MAP_CONSTRAINTS.maxBounds,
      maxPitch: 75,
      scrollZoom: false,
      attributionControl: false
    }));
    this.map.once('load', () => this.addViewLayers());
  },
  beforeUnmount() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  },
  methods: {
    async loadCollection(path) {
      const url = collectionUrl(this.rootUrl, path);
      if (!url) {
        return null;
      }
      if (!this.getStac(url)) {
        await this.$store.dispatch('load', { url, show: false }).catch(() => null);
      }
      return this.getStac(url);
    },
    async addViewLayers() {
      const paths = [...new Set(this.views.flatMap(view => (view.layers || []).map(layer => layer.collection)))];
      const stacs = await Promise.all(paths.map(path => this.loadCollection(path)));
      if (!this.map) {
        return;
      }
      const archives = new Map(paths.map((path, i) => [path, pmtilesSource(stacs[i])]));
      for (const view of this.views) {
        this.layerIds[view.id] = [];
        (view.layers || []).forEach((layer, i) => {
          const archive = archives.get(layer.collection);
          if (!archive) {
            return;
          }
          const sourceId = `pmtiles-${archive.url}`;
          if (!this.map.getSource(sourceId)) {
            this.map.addSource(sourceId, { type: 'vector', url: `pmtiles://${archive.url}` });
          }
          const style = { ...layer };
          delete style.collection;
          const id = `${view.id}-${i}`;
          this.map.addLayer({ ...style, id, source: sourceId, 'source-layer': archive.layer, layout: { ...style.layout, visibility: 'none' } });
          this.layerIds[view.id].push(id);
          if (typeof view.tooltip === 'function') {
            this.map.on('mousemove', id, event => this.showTip(view, event));
            this.map.on('mouseleave', id, () => this.hideTip());
          }
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
      this.hideTip();
      if (!this.layerIds[viewId]) {
        return; // addViewLayers() calls show() again when the layers exist.
      }
      for (const [id, ids] of Object.entries(this.layerIds)) {
        for (const layerId of ids) {
          this.map.setLayoutProperty(layerId, 'visibility', id === viewId ? 'visible' : 'none');
        }
      }
      const { brightness = 1, saturation = 0 } = view.imagery || {};
      for (const image of this.imagery) {
        this.map.setPaintProperty(IMAGERY_PREFIX + image.id, 'raster-brightness-max', brightness);
        this.map.setPaintProperty(IMAGERY_PREFIX + image.id, 'raster-saturation', saturation);
      }
      if (this.reducedMotion) {
        this.map.jumpTo(view.camera || {});
        return;
      }
      this.map.easeTo({ ...view.camera, duration: 1600 });
      if (!this.grown.has(viewId)) {
        this.grown.add(viewId);
        this.grow(view);
      }
    },
    // Raises the extrusions of a view from the ground, once per view.
    grow(view) {
      const targets = (view.layers || [])
        .map((layer, i) => ({ layer, id: `${view.id}-${i}` }))
        .filter(({ layer, id }) => layer.type === 'fill-extrusion' && this.map.getLayer(id));
      if (targets.length === 0) {
        return;
      }
      const start = performance.now();
      const step = now => {
        if (!this.map) {
          return;
        }
        const k = Math.min(1, (now - start) / GROW_MS);
        const ease = 1 - Math.pow(1 - k, 3);
        for (const { layer, id } of targets) {
          for (const prop of ['fill-extrusion-height', 'fill-extrusion-base']) {
            const value = layer.paint?.[prop];
            if (value !== undefined) {
              this.map.setPaintProperty(id, prop, k < 1 ? ['*', ease, value] : value);
            }
          }
        }
        if (k < 1) {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    },
    showTip(view, event) {
      const feature = event.features?.[0];
      const tip = feature ? view.tooltip(feature.properties || {}) : null;
      if (!tip?.title) {
        this.hideTip();
        return;
      }
      this.$refs.tipTitle.textContent = tip.title;
      this.$refs.tipText.textContent = tip.text || '';
      this.$refs.tip.style.transform = `translate(${event.point.x + 14}px, ${event.point.y + 14}px)`;
      this.$refs.tip.hidden = false;
    },
    hideTip() {
      if (this.$refs.tip) {
        this.$refs.tip.hidden = true;
      }
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

.per-hero-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 6px;
  border-radius: 2px;
  vertical-align: -1px;
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

.per-hero-tip {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 3;
  display: grid;
  padding: 8px 10px;
  border-radius: 6px;
  background-color: $per-solid-bg;
  color: $per-solid-fg;
  font-size: 0.8rem;
  line-height: 1.35;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
</style>
