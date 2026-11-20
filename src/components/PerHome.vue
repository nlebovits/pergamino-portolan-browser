<template>
  <div class="per-home">
    <section class="per-hero" :class="{ 'has-map': hero }" :aria-label="$t('pergamino.home.heroLabel')">
      <PerHeroMap v-if="hero && rootUrl" :config="hero" :rootUrl="rootUrl" />
      <div class="per-hero-copy">
        <h1>{{ $t('pergamino.home.title') }}</h1>
        <p>{{ complete ? $t('pergamino.home.lead', { layers: $t('pergamino.home.layerCount', entries.length) }) : $t('pergamino.home.leadLoading') }}</p>
        <form class="per-search" role="search" @submit.prevent="showResults">
          <label for="per-search-input" class="visually-hidden">{{ $t('pergamino.home.searchLabel') }}</label>
          <input
            id="per-search-input" ref="search" v-model="query" type="search"
            autocomplete="off"
            :placeholder="$t('pergamino.home.searchPlaceholder')"
          >
          <kbd aria-hidden="true">/</kbd>
        </form>
        <div v-if="complete" class="per-readout">
          <span><strong>{{ entries.length }}</strong> {{ $t('pergamino.home.layers', entries.length) }}</span>
          <span><strong>{{ categoryCount }}</strong> {{ $t('pergamino.home.categories', categoryCount) }}</span>
          <span v-if="sources.length > 0"><strong>{{ sources.length }}</strong> {{ $t('pergamino.home.sources', sources.length) }}</span>
        </div>
      </div>
    </section>

    <section v-if="featured.length > 0" class="per-block" aria-labelledby="per-featured-heading">
      <div class="per-head">
        <h2 id="per-featured-heading">{{ $t('pergamino.home.featured') }}</h2>
      </div>
      <div class="per-featured">
        <PerLayerTile v-for="item in featured" :key="item.url" :entry="item" large showCategory />
      </div>
    </section>

    <section ref="browser" class="per-block" aria-labelledby="per-browser-heading">
      <div class="per-head">
        <div>
          <h2 id="per-browser-heading">{{ searching ? $t('pergamino.home.results') : $t('pergamino.home.browse') }}</h2>
          <p>{{ summary }}</p>
        </div>
        <label v-if="sources.length > 1" class="per-source" for="per-source-select">
          {{ $t('pergamino.home.source') }}
          <select id="per-source-select" v-model="source">
            <option :value="null">{{ $t('pergamino.home.allSources') }}</option>
            <option v-for="s in sources" :key="s.name" :value="s.name">{{ s.name }} ({{ s.count }})</option>
          </select>
        </label>
      </div>

      <div v-if="!searching && groups.length > 1" class="per-chips" role="group" :aria-label="$t('pergamino.home.categoriesLabel')">
        <button
          v-for="group in groups" :key="String(group.key)" type="button"
          :aria-pressed="group.key === selectedKey ? 'true' : 'false'"
          :disabled="group.loaded && countIn(group) === 0"
          @click="selected = group.key"
        >
          {{ groupTitle(group) }}<b v-if="group.loaded">{{ countIn(group) }}</b>
        </button>
      </div>

      <div v-if="shown.length > 0" class="per-grid">
        <PerLayerTile v-for="item in shown" :key="item.url" :entry="item" :showCategory="searching" />
      </div>
      <p v-else-if="complete" class="per-empty">{{ $t('pergamino.home.noMatches') }}</p>

      <div v-if="visible.length > pageSize" class="per-more">
        <button v-if="expanded" type="button" class="per-button" @click="collapse">{{ $t('pergamino.home.showLess') }}</button>
        <button v-else type="button" class="per-button" @click="expanded = true">{{ moreLabel }}</button>
      </div>
    </section>

    <section v-if="tools.length > 0" class="per-qgis" aria-labelledby="per-qgis-heading">
      <div class="per-use-head">
        <h2 id="per-qgis-heading">{{ $t('pergamino.home.use.title') }}</h2>
        <div class="per-tabs" role="tablist" :aria-label="$t('pergamino.home.use.tools')" @keydown="tabKey">
          <button
            v-for="t in tools" :id="`per-tab-${t}`" :key="t" ref="tabs"
            type="button" role="tab"
            :aria-selected="t === activeTool ? 'true' : 'false'" :aria-controls="`per-panel-${t}`"
            @click="tool = t"
          >
            {{ $t(`pergamino.home.use.${t}.tab`) }}
          </button>
        </div>
      </div>

      <div
        v-if="activeTool === 'qgis'" id="per-panel-qgis" class="per-use-panel"
        role="tabpanel" aria-labelledby="per-tab-qgis"
      >
        <div>
          <p>{{ $t('pergamino.home.qgis.text') }}</p>
          <a class="per-button solid" :href="qgisPluginUrl" target="_blank" rel="noopener noreferrer">{{ $t('pergamino.home.qgis.button') }}</a>
          <p class="per-qgis-req">{{ $t('pergamino.home.qgis.requirements') }}</p>
        </div>
        <ol>
          <li>
            <i18n-t keypath="pergamino.home.qgis.step1" tag="span" scope="global">
              <template #menu><strong>{{ $t('pergamino.home.qgis.menu') }}</strong></template>
            </i18n-t>
          </li>
          <li>
            <i18n-t keypath="pergamino.home.qgis.step2" tag="span" scope="global">
              <template #plugin><strong>Portolan Registry</strong></template>
            </i18n-t>
          </li>
          <li>
            <i18n-t keypath="pergamino.home.qgis.step3" tag="span" scope="global">
              <template #catalog><strong>{{ catalogTitle }}</strong></template>
            </i18n-t>
          </li>
        </ol>
      </div>

      <div
        v-else-if="snippets" :id="`per-panel-${activeTool}`" class="per-use-panel"
        role="tabpanel" :aria-labelledby="`per-tab-${activeTool}`"
      >
        <div>
          <p>{{ $t(`pergamino.home.use.${activeTool}.text`) }}</p>
          <p class="per-qgis-req">
            <i18n-t keypath="pergamino.home.use.example" tag="span" scope="global">
              <template #layer>
                <StacLink :data="example.entry.link" :title="example.entry.title" hideIcon />
              </template>
            </i18n-t>
          </p>
        </div>
        <div class="per-code">
          <div class="per-code-bar">
            <span>{{ $t(`pergamino.home.use.${activeTool}.tab`) }}</span>
            <button type="button" class="per-copy" @click="copy">{{ copied ? $t('pergamino.home.use.copied') : $t('pergamino.home.use.copy') }}</button>
          </div>
          <pre tabindex="0" :aria-label="$t(`pergamino.home.use.${activeTool}.tab`)"><code>{{ snippets[activeTool] }}</code></pre>
        </div>
      </div>
    </section>
  </div>
</template>

<script>
import { defineAsyncComponent, defineComponent } from 'vue';
import { mapGetters, mapState } from 'vuex';
import homeConfig from '../../home.config';
import PerLayerTile from './PerLayerTile.vue';
import StacLink from './StacLink.vue';
import {
  allEntries, featuredEntries, filterEntries, homeGroups, parquetSource, querySnippets, sourceOptions
} from '../utils/perHome';

// The tiles a category shows before the "Ver las N capas" button.
const PAGE_SIZE = 8;
// Catalog and collection files that load at the same time. Each is 1 to 10 KB.
const LOAD_POOL = 12;

// The home view of the root catalog: a map with a search field, the featured
// layers, a browser over every layer by category and source, and a band with
// one tab each for QGIS, Python and DuckDB. Catalog.vue mounts it for the root only. The categories, layers,
// sources and featured layers come from the catalog. home.config.js holds
// the rest.
export default defineComponent({
  name: 'PerHome',
  components: {
    PerHeroMap: defineAsyncComponent(() => import('./PerHeroMap.vue')),
    PerLayerTile,
    StacLink
  },
  data() {
    return {
      query: '',
      source: null,
      selected: undefined,
      expanded: false,
      pageSize: PAGE_SIZE,
      tool: null,
      copied: false,
      hero: homeConfig.hero || null,
      qgisPluginUrl: homeConfig.qgisPluginUrl || null
    };
  },
  computed: {
    ...mapState(['data', 'catalogTitle']),
    ...mapGetters(['catalogs', 'getStac']),
    rootUrl() {
      return typeof this.data?.getAbsoluteUrl === 'function' ? this.data.getAbsoluteUrl() : null;
    },
    groups() {
      return homeGroups(this.catalogs, this.getStac);
    },
    entries() {
      return allEntries(this.groups);
    },
    // Every category and every layer has loaded, so counts are final.
    complete() {
      return this.groups.length > 0 && this.groups.every(g => g.loaded) && this.entries.every(e => e.loaded);
    },
    categoryCount() {
      return this.groups.filter(g => g.key !== null).length;
    },
    sources() {
      return this.complete ? sourceOptions(this.entries) : [];
    },
    // A layer shows here as soon as its collection loads. An unloaded layer
    // has no keywords yet, so it cannot match.
    featured() {
      return featuredEntries(this.entries, homeConfig.featuredKeyword, homeConfig.featuredLimit);
    },
    searching() {
      return this.query.trim().length > 0;
    },
    // The chosen category, or the first one with a layer for this source.
    selectedKey() {
      const usable = this.groups.filter(g => !g.loaded || this.countIn(g) > 0);
      if (usable.some(g => g.key === this.selected)) {
        return this.selected;
      }
      return usable[0]?.key ?? null;
    },
    selectedGroup() {
      return this.groups.find(g => g.key === this.selectedKey) || null;
    },
    visible() {
      const pool = this.searching ? this.entries : (this.selectedGroup?.entries || []);
      return filterEntries(pool, { source: this.source, query: this.query });
    },
    shown() {
      return this.expanded ? this.visible : this.visible.slice(0, PAGE_SIZE);
    },
    summary() {
      const layers = this.$t('pergamino.home.layerCount', this.visible.length);
      if (this.searching) {
        return this.$t('pergamino.home.resultsSummary', { layers, query: this.query.trim() });
      }
      if (!this.selectedGroup) {
        return '';
      }
      const category = this.groupTitle(this.selectedGroup);
      return this.source
        ? this.$t('pergamino.home.categorySourceSummary', { layers, source: this.source, category })
        : this.$t('pergamino.home.categorySummary', { layers, category });
    },
    // The layer of the Python and DuckDB examples: the first layer on view with
    // a Parquet file, so that the examples follow the chosen category.
    example() {
      for (const entry of [...this.shown, ...this.featured, ...this.entries]) {
        const source = entry.loaded ? parquetSource(entry.stac) : null;
        if (source) {
          return { entry, source };
        }
      }
      return null;
    },
    snippets() {
      return this.example ? querySnippets(this.example.source) : null;
    },
    tools() {
      return [
        ...(this.qgisPluginUrl ? ['qgis'] : []),
        ...(this.snippets ? ['python', 'duckdb'] : [])
      ];
    },
    activeTool() {
      return this.tools.includes(this.tool) ? this.tool : this.tools[0];
    },
    moreLabel() {
      const count = this.visible.length;
      return this.searching
        ? this.$t('pergamino.home.showAllResults', { count })
        : this.$t('pergamino.home.showAll', { count, category: this.groupTitle(this.selectedGroup) });
    }
  },
  watch: {
    // Counts, sources, featured layers and thumbnails need every category
    // and every layer. Load each unloaded catalog and layer here, LOAD_POOL
    // at a time. The app's background queue loads 3 every 200 ms, which
    // takes about 13 s for this catalog. When a category loads, this watcher
    // runs again with its layers.
    groups: {
      immediate: true,
      handler(groups) {
        if (!this.queued) {
          // Immediate watchers run before created().
          this.queued = new Set();
          this.pending = [];
          this.inFlight = 0;
        }
        const urls = [
          ...groups.filter(g => g.key && !g.loaded).map(g => g.key),
          ...allEntries(groups).filter(e => !e.loaded).map(e => e.url)
        ];
        for (const url of urls) {
          if (!this.queued.has(url)) {
            this.queued.add(url);
            this.pending.push(url);
          }
        }
        this.pump();
      }
    },
    visible() {
      this.expanded = false;
    },
    activeTool() {
      this.copied = false;
    }
  },
  mounted() {
    window.addEventListener('keydown', this.focusSearch);
  },
  beforeUnmount() {
    this.pending = [];
    window.removeEventListener('keydown', this.focusSearch);
  },
  methods: {
    // Starts loads until LOAD_POOL are in flight. Each finished load starts
    // the next one.
    pump() {
      while (this.inFlight < LOAD_POOL && this.pending.length > 0) {
        const url = this.pending.shift();
        this.inFlight++;
        this.$store.dispatch('load', { url, omitApi: true })
          .catch(() => null)
          .finally(() => {
            this.inFlight--;
            this.pump();
          });
      }
    },
    groupTitle(group) {
      if (!group) {
        return '';
      }
      return group.key === null ? this.$t('pergamino.home.otherLayers') : group.title;
    },
    countIn(group) {
      return filterEntries(group.entries, { source: this.source }).length;
    },
    // Shows the first page again, and scrolls back to the heading of the
    // browser when it is above the view. The header is sticky, so the
    // heading stops under it.
    collapse() {
      this.expanded = false;
      const browser = this.$refs.browser;
      if (!browser) {
        return;
      }
      const header = document.querySelector('#stac-browser > header');
      const offset = (header ? header.getBoundingClientRect().height : 0) + 16;
      const top = browser.getBoundingClientRect().top;
      if (top < offset) {
        window.scrollBy({ top: top - offset, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    },
    // Arrow keys, Home and End move between the tabs. Tab also reaches each
    // tab, so a keyboard user can step through them either way.
    tabKey(event) {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      const count = this.tools.length;
      let index = this.tools.indexOf(this.activeTool);
      if (event.key in keys) {
        index = (index + keys[event.key] + count) % count;
      }
      else if (event.key === 'Home') {
        index = 0;
      }
      else if (event.key === 'End') {
        index = count - 1;
      }
      else {
        return;
      }
      event.preventDefault();
      this.tool = this.tools[index];
      this.$nextTick(() => this.$refs.tabs?.[index]?.focus());
    },
    async copy() {
      try {
        await navigator.clipboard.writeText(this.snippets[this.activeTool]);
        this.copied = true;
      }
      catch {
        this.copied = false;
      }
    },
    showResults() {
      this.$refs.browser?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    // "/" moves the focus to the search field, unless the focus is in a field.
    focusSearch(event) {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));
      if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey && this.$refs.search) {
        event.preventDefault();
        this.$refs.search.focus();
      }
    }
  }
});
</script>

<style lang="scss">
@import 'bootstrap/scss/mixins';
@import "../theme/variables.scss";

// The hero and the QGIS band span the viewport, like PerHeader. Their content
// keeps the left edge of the page column. custom.scss clips the horizontal
// overflow of the 50vw term. The upstream layout puts --sb-block-gap between
// the header, the page and the footer. The hero and the QGIS band cancel it,
// so the map meets the header and the band meets the footer.
$per-bleed: calc(50% - 50vw);
$per-align: calc(50vw - 50%);
$per-pull: calc(-1 * var(--sb-block-gap, #{$block-gap}));

.per-home {
  h2 {
    margin: 0;
    font-size: 1.5rem;
  }
}

.per-hero {
  position: relative;
  margin-top: $per-pull;
  margin-inline: $per-bleed;
  padding: 2rem $per-align;

  // A thin line ends the map, as on the QGIS band.
  &.has-map {
    border-bottom: 1px solid $per-line;
    display: flex;
    align-items: center;
    height: min(640px, 78vh);
    min-height: 480px;
  }

  @include media-breakpoint-down(md) {
    &.has-map {
      flex-direction: column-reverse;
      align-items: stretch;
      height: auto;
      min-height: 0;
      padding: 0;

      .per-hero-copy {
        padding: 1.75rem $per-gutter;
      }
    }
  }
}

.per-hero-copy {
  position: relative;
  z-index: 2;
  max-width: 470px;

  h1 {
    margin: 0 0 1rem;
    color: $per-ink;
    font-size: clamp(2rem, 4.3vw, 3.3rem);
    font-weight: $per-weight-display;
    line-height: 1;
    letter-spacing: -0.02em;
    text-wrap: balance;
  }

  > p {
    max-width: 40ch;
    margin: 0 0 1.4rem;
    color: $per-ink-soft;
  }
}

.per-search {
  display: flex;
  overflow: hidden;
  border: 1px solid $per-line;
  border-radius: $per-radius;
  background-color: $per-raise;

  &:focus-within {
    border-color: $per-rosa;
  }

  input {
    flex: 1;
    min-width: 0;
    padding: 14px 16px;
    border: 0;
    background: transparent;
    color: $per-ink;
    font-weight: 500;
    font-size: 1rem;

    &::placeholder {
      color: $per-muted;
    }

    &:focus {
      outline: none;
    }
  }

  kbd {
    @include media-breakpoint-down(md) {
      display: none;
    }

    align-self: center;
    margin-right: 12px;
    padding: 2px 7px;
    border: 1px solid $per-line;
    border-radius: 4px;
    background: none;
    color: $per-muted;
    font-family: inherit;
    font-size: 0.74rem;
  }
}

.per-readout {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 22px;
  margin: 18px 0 0;
  color: $per-muted;
  font-size: 0.86rem;
  font-variant-numeric: tabular-nums;

  strong {
    color: $per-ink;
    font-family: $per-font-mono;
    font-weight: $per-weight-title;
  }
}

.per-block {
  padding-block: 44px 0;
}

.per-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px 20px;
  margin-bottom: 20px;

  p {
    margin: 4px 0 0;
    color: $per-muted;
    font-size: 0.88rem;
  }
}

.per-featured {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;

  @include media-breakpoint-down(md) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.per-source {
  display: flex;
  align-items: center;
  gap: 10px;
  color: $per-muted;
  font-size: 0.86rem;

  select {
    width: auto;
    max-width: min(18rem, 60vw);
    padding: 8px 12px;
    border: 1px solid $per-line;
    border-radius: $per-radius;
    background-color: $per-paper;
    color: $per-ink;
    font-weight: 500;
    font-size: 0.9rem;
  }
}

// The category chips scroll sideways when they do not fit.
.per-chips {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  padding-bottom: 6px;
  overflow-x: auto;
  scrollbar-width: thin;

  button {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 8px 14px;
    border: 1px solid $per-line;
    border-radius: 999px;
    background: none;
    color: $per-ink-soft;
    font-weight: 500;
    font-size: 0.88rem;

    b {
      padding: 1px 8px;
      border-radius: 999px;
      background-color: $per-raise;
      color: $per-ink;
      font-family: $per-font-mono;
      font-weight: $per-weight-title;
      font-size: 0.74rem;
      font-variant-numeric: tabular-nums;
    }

    &:hover {
      border-color: $per-muted;
    }

    &[aria-pressed="true"] {
      border-color: $per-solid-bg;
      background-color: $per-solid-bg;
      color: $per-solid-fg;

      b {
        background-color: rgba($per-solid-fg, 0.18);
        color: $per-solid-fg;
      }
    }

    &:disabled {
      opacity: 0.4;
    }
  }
}

.per-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;

  @include media-breakpoint-down(lg) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  @include media-breakpoint-down(md) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.per-empty {
  padding: 28px;
  border: 1px dashed $per-line;
  border-radius: $per-radius;
  color: $per-ink-soft;
}

.per-more {
  display: flex;
  margin-top: 22px;
}

#stac-browser .per-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border: 1px solid $per-line;
  border-radius: $per-radius;
  background-color: $per-paper;
  color: $per-ink;
  font-weight: $per-weight-label;
  font-size: 0.9rem;
  text-decoration: none;

  &:hover {
    border-color: $per-rosa;
  }

  &.solid {
    border-color: $per-solid-bg;
    background-color: $per-solid-bg;
    color: $per-solid-fg;
  }
}

.per-qgis {
  margin: 44px $per-bleed $per-pull;
  padding: 44px $per-align;
  border-block: 1px solid $per-line;
  background-color: $per-paper;

  h2 {
    margin-bottom: 12px;
  }

  p {
    max-width: 48ch;
    margin: 0 0 18px;
    color: $per-ink-soft;
  }

  ol {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: per-step;
  }

  li {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    gap: 12px;
    padding: 14px 0;
    border-bottom: 1px solid $per-line;
    color: $per-ink-soft;
    counter-increment: per-step;

    &::before {
      content: counter(per-step);
      color: $per-accent-ink;
      font-family: $per-font-mono;
      font-weight: $per-weight-display;
    }

    &:last-child {
      border-bottom: 0;
    }

    strong {
      color: $per-ink;
      font-weight: $per-weight-label;
    }
  }

}

.per-use-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px 24px;
  margin-bottom: 28px;

  h2 {
    margin: 0 !important;
  }
}

// The tool tabs, drawn like the category chips.
.per-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid $per-line;
  border-radius: 999px;
  background-color: $per-night;

  button {
    padding: 7px 18px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: $per-ink-soft;
    font-weight: $per-weight-label;
    font-size: 0.9rem;

    &:hover {
      color: $per-ink;
    }

    &[aria-selected="true"] {
      background-color: $per-solid-bg;
      color: $per-solid-fg;
    }
  }
}

.per-use-panel {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
  gap: 40px;
  align-items: center;

  @include media-breakpoint-down(md) {
    grid-template-columns: minmax(0, 1fr);
  }
}

// The code box: a bar with the language and the copy button, then the code.
// A long URL scrolls sideways, so that the copied code stays unchanged.
.per-code {
  min-width: 0;
  overflow: hidden;
  border: 1px solid $per-line;
  border-radius: $per-radius-large;
  background-color: $per-night;

  pre {
    margin: 0;
    padding: 16px 20px 18px;
    overflow-x: auto;
    color: $per-ink;
    font-family: $per-font-mono;
    font-size: 0.84rem;
    line-height: 1.6;
  }

  code {
    color: inherit;
    font: inherit;
    white-space: pre;
  }
}

.per-code-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px 8px 20px;
  border-bottom: 1px solid $per-line;
  color: $per-muted;
  font-family: $per-font-mono;
  font-size: 0.78rem;
}

#stac-browser .per-copy {
  padding: 4px 10px;
  border: 1px solid $per-line;
  border-radius: $per-radius;
  background-color: $per-paper;
  color: $per-ink-soft;
  font-size: 0.78rem;
  font-weight: $per-weight-label;

  &:hover {
    border-color: $per-rosa;
    color: $per-ink;
  }
}

.per-qgis-req {
  margin: 12px 0 0 !important;
  color: $per-muted !important;
  font-size: 0.82rem;
}
</style>
