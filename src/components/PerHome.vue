<template>
  <section class="per-home">
    <p v-if="lead" class="per-lead">{{ lead }}</p>
    <p v-if="totals.complete && totals.layers > 0" class="per-summary">
      {{ $t('pergamino.summary', { layers: $t('pergamino.layerCount', totals.layers), categories: $t('pergamino.categoryCount', totals.categories) }) }}
    </p>

    <section v-if="!selectedSource && cards.length > 0" class="per-topics-section" aria-labelledby="per-topics-heading">
      <h2 id="per-topics-heading" class="visually-hidden">{{ $t('pergamino.topicsHeading') }}</h2>
      <ul class="per-topics">
        <li v-for="card in cards" :key="card.url" class="per-topic" :class="{ loading: !card.loaded }">
          <h3 class="per-topic-title">{{ card.title }}</h3>
          <p v-if="card.description" class="per-topic-description">{{ card.description }}</p>
          <StacLink :data="card.link" :title="cardLinkLabel(card)" class="per-topic-more" hideIcon>
            {{ cardLinkLabel(card) }}<BIconArrowRight class="per-topic-arrow" aria-hidden="true" />
          </StacLink>
        </li>
      </ul>
    </section>

    <section v-if="sources.length > 0 || selectedSource" class="per-sources" aria-labelledby="per-sources-heading">
      <h2 id="per-sources-heading">{{ $t('pergamino.bySource') }}</h2>
      <div class="per-chips">
        <button
          v-for="source in sources" :key="source.name" type="button" class="per-chip"
          :aria-pressed="selectedSource === source.name ? 'true' : 'false'"
          @click="toggleSource(source.name)"
        >
          {{ source.name }} <span class="per-chip-count">{{ source.count }}</span>
        </button>
        <button v-if="selectedSource" type="button" class="per-chip per-chip-clear" @click="toggleSource(null)">
          {{ $t('pergamino.clearFilter') }}
        </button>
      </div>
    </section>
    <p v-else-if="sourcesLoading" class="per-sources-loading">
      {{ $t('pergamino.bySourceLoading') }} {{ loadedLeaves }} / {{ totalLeaves }}
    </p>
  </section>
</template>

<script>
import { defineComponent } from 'vue';
import { mapGetters, mapState } from 'vuex';
import { STAC } from 'stac-js';
import BIconArrowRight from '~icons/bi/arrow-right';
import StacLink from './StacLink.vue';
import { catalogTotals, expandChildren, leadSentence, sourceCounts, topicCards } from '../utils/perHome';

// The home view of the root catalog: the topic grid with real counts, and the
// optional "Por fuente" chips. Catalog.vue mounts it for the root only. The
// filtered collection list itself is the stock Catalogs grid in Catalog.vue.
export default defineComponent({
  name: 'PerHome',
  components: {
    BIconArrowRight,
    StacLink
  },
  computed: {
    ...mapState(['data', 'stateQueryParameters']),
    ...mapGetters(['catalogs', 'getStac']),
    lead() {
      return leadSentence(this.data?.description);
    },
    cards() {
      return topicCards(this.catalogs, this.getStac);
    },
    totals() {
      return catalogTotals(this.cards);
    },
    leaves() {
      return expandChildren(this.catalogs, this.getStac);
    },
    // The leaves below the loaded topics. A topic that has not loaded is
    // still a leaf here, so the source counts wait until every topic loads.
    collectionLeaves() {
      if (!this.totals.complete) {
        return [];
      }
      return this.leaves.filter(leaf => leaf.expanded);
    },
    totalLeaves() {
      return this.collectionLeaves.length;
    },
    loadedLeaves() {
      return this.collectionLeaves.filter(leaf => leaf.stac instanceof STAC).length;
    },
    sourcesLoading() {
      return this.totalLeaves > 0 && this.loadedLeaves < this.totalLeaves;
    },
    // Counts show only when every collection has loaded, so a chip never
    // shows a partial number.
    sources() {
      if (this.totalLeaves === 0 || this.sourcesLoading) {
        return [];
      }
      return sourceCounts(this.collectionLeaves.map(leaf => leaf.stac));
    },
    selectedSource() {
      return this.stateQueryParameters.fuente ?? null;
    }
  },
  watch: {
    // The topic cards need each topic catalog, and the source chips need each
    // collection. The background loader normally loads only the cards that
    // are visible, so queue every unloaded leaf here. The topics load first.
    // When a topic loads, this watcher runs again with its collections.
    leaves: {
      immediate: true,
      handler(leaves) {
        if (!Array.isArray(leaves)) {
          return;
        }
        // Immediate watchers run before created(), so create the set here.
        if (!this.queued) {
          this.queued = new Set();
        }
        for (const leaf of leaves) {
          const url = leaf?.url;
          if (url && !leaf.stac && !this.queued.has(url)) {
            this.queued.add(url);
            this.$store.commit('queue', url);
          }
        }
      }
    }
  },
  methods: {
    // The one link of a topic card. It names the collection count, or says
    // "categoría" when the topic holds nested catalogs.
    cardLinkLabel(card) {
      if (card.loaded && card.categories === 0 && card.layers > 0) {
        return this.$t('pergamino.seeAll', card.layers);
      }
      return this.$t('pergamino.seeCategory');
    },
    toggleSource(name) {
      this.$store.commit('updateState', {
        type: 'fuente',
        value: name && this.selectedSource !== name ? name : null
      });
    }
  }
});
</script>

<style lang="scss">
@import 'bootstrap/scss/mixins';
@import "../theme/variables.scss";

.per-home {
  margin-bottom: $block-gap;
}

.per-lead {
  max-width: 60rem;
  margin-bottom: 0.25rem;
  color: $per-ink-soft;
}

.per-summary {
  margin-bottom: $block-gap;
  color: $per-ink-soft;
  font-weight: $per-weight-label;
}

.per-topics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: $block-gap;
  margin: 0;
  padding: 0;
  list-style: none;

  @include media-breakpoint-down(lg) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @include media-breakpoint-down(md) {
    grid-template-columns: minmax(0, 1fr);
  }
}

// The GeoNode resource card: white, a thin border, a soft shadow, 5px corners.
.per-topic {
  display: flex;
  flex-direction: column;
  padding: 1rem 1.1rem;
  border: 1px solid $per-card-border;
  border-radius: $per-radius;
  background-color: white;
  box-shadow: $per-card-shadow;

  &.loading {
    opacity: 0.6;
  }
}

.per-topic-title {
  margin-bottom: 0.4rem;
  font-size: 1.1rem;
  font-weight: $per-weight-title;
}

.per-topic-description {
  display: -webkit-box;
  margin-bottom: 0.6rem;
  overflow: hidden;
  color: $per-ink-soft;
  font-size: 0.875rem;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  -webkit-box-orient: vertical;
}

#stac-browser .per-topic-more {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 0.4rem;
  margin-top: auto;
  color: $per-ink;
  font-size: 0.9rem;
  font-weight: $per-weight-title;
  text-decoration: underline;

  &:hover,
  &:focus-visible {
    color: $per-ink-hover;

    .per-topic-arrow {
      transform: translateX(3px);
    }
  }
}

.per-topic-arrow {
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.per-sources {
  margin-top: 1.5rem;

  h2 {
    font-size: 1.1rem;
  }
}

.per-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

// The GeoNode search button: light grey, a thin border, 5px corners, a soft shadow.
.per-chip {
  padding: 0.3rem 0.75rem;
  border: 1px solid $per-search-border;
  border-radius: $per-radius;
  background-color: $per-search-bg;
  box-shadow: $per-search-shadow;
  color: $per-ink;
  font-size: 0.875rem;
  text-align: left;

  &:hover {
    background-color: $per-search-hover;
  }

  &[aria-pressed="true"] {
    border-color: $per-ink;
    background-color: $per-ink;
    color: white;
  }
}

.per-chip-count {
  margin-left: 0.25rem;
  font-weight: $per-weight-title;
}

.per-chip-clear {
  background-color: white;
}

.per-sources-loading {
  margin-top: 1.5rem;
  color: $per-ink-soft;
  font-size: 0.875rem;
}
</style>
