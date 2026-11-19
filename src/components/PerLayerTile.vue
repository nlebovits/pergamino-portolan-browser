<template>
  <StacLink :data="entry.link" :title="entry.title" class="per-tile" :class="{ large, loading: !entry.loaded }" hideIcon>
    <span class="per-tile-pic">
      <img v-if="entry.thumbnail" :src="entry.thumbnail" alt="" loading="lazy" :crossorigin="crossOriginMedia">
    </span>
    <span class="per-tile-text">
      <span v-if="showCategory && entry.groupTitle" class="per-tile-category">{{ entry.groupTitle }}</span>
      <span class="per-tile-title">{{ entry.title }}</span>
      <span v-if="entry.isCatalog" class="per-tile-source">{{ $t('pergamino.home.subcategory') }}</span>
      <span v-else-if="entry.source" class="per-tile-source">{{ entry.source }}</span>
      <span v-if="large" class="per-tile-open">{{ $t('pergamino.home.openLayer') }}</span>
    </span>
  </StacLink>
</template>

<script>
import { mapState } from 'vuex';
import StacLink from './StacLink.vue';

// One layer of the home view: thumbnail, title, source, and, when asked, its
// category. The whole tile is one link to the layer. A layer without a
// thumbnail keeps an empty picture area, so the grid stays even.
export default {
  name: 'PerLayerTile',
  components: {
    StacLink
  },
  props: {
    entry: {
      type: Object,
      required: true
    },
    large: {
      type: Boolean,
      default: false
    },
    showCategory: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    ...mapState(['crossOriginMedia'])
  }
};
</script>

<style lang="scss">
@import 'bootstrap/scss/mixins';
@import "../theme/variables.scss";

#stac-browser .per-tile {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 8px;
  color: $per-ink;
  text-decoration: none;

  &.loading {
    opacity: 0.6;
  }

  &:hover .per-tile-title,
  &:focus-visible .per-tile-title {
    text-decoration: underline;
    text-decoration-color: $per-rosa;
    text-underline-offset: 3px;
  }
}

.per-tile-pic {
  display: block;
  aspect-ratio: 3 / 2;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid $per-line;
  border-radius: $per-radius;
  background-color: $per-placeholder;

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.per-tile-text {
  display: grid;
  gap: 4px;
  align-content: start;
  min-width: 0;
}

.per-tile-category {
  color: $per-category-ink;
  font-size: 0.78rem;
  font-weight: $per-weight-label;
}

.per-tile-title {
  font-weight: $per-weight-label;
  font-size: 0.94rem;
  line-height: 1.3;
}

.per-tile-source {
  color: $per-muted;
  font-size: 0.8rem;
}

// A featured layer: a white card with the text under the picture.
#stac-browser .per-tile.large {
  gap: 0;
  overflow: hidden;
  border: 1px solid $per-line;
  border-radius: $per-radius-large;
  background-color: $per-paper;

  .per-tile-pic {
    border: 0;
    border-radius: 0;

    // Catalog thumbnails carry a margin around the data. Crop into it.
    img {
      transform: scale(1.12);
    }
  }

  .per-tile-text {
    padding: 16px 18px 18px;
  }

  .per-tile-title {
    font-size: 1.12rem;
    font-weight: $per-weight-title;
    line-height: 1.25;
    text-wrap: balance;
    text-decoration: none;
  }

  .per-tile-source {
    font-size: 0.84rem;
  }

  .per-tile-open {
    margin-top: 10px;
    color: $per-accent-ink;
    font-size: 0.86rem;
    font-weight: $per-weight-label;
  }

  &:hover,
  &:focus-visible {
    border-color: $per-rosa;

    .per-tile-open {
      text-decoration: underline;
      text-underline-offset: 3px;
    }
  }

  // Picture beside the text on a mid-size screen, above it on a phone.
  @include media-breakpoint-down(md) {
    grid-template-columns: 40% minmax(0, 1fr);
    grid-template-rows: auto;

    .per-tile-pic {
      aspect-ratio: auto;
      height: 100%;
    }
  }

  @include media-breakpoint-down(sm) {
    grid-template-columns: minmax(0, 1fr);

    .per-tile-pic {
      aspect-ratio: 3 / 2;
    }
  }
}
</style>
