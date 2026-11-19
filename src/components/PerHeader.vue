<template>
  <div class="per-header site">
    <div class="per-inner">
      <component :is="root ? 'StacLink' : 'div'" v-bind="root ? { data: root } : {}" class="per-brand">
        <img :src="logo" :alt="$t('pergamino.logoAlt')" class="per-logo">
        <span class="per-wordmark"><HeaderTitle ref="headerTitle" /></span>
      </component>

      <div class="per-tools">
        <button
          v-if="showRootStats" id="popover-root-btn" type="button" class="per-action"
          :title="serviceType" tabindex="0"
        >
          {{ $t('pergamino.about') }}
        </button>
        <button v-if="canAuthenticate" type="button" class="per-action" :title="authTitle" @click="$emit('logInOut')">
          <component :is="authIcon" /> {{ authLabel }}
        </button>
        <LanguageChooser
          v-if="locales.length > 1"
          class="per-lang"
          :data="data" :currentLocale="currentLocale" :locales="locales"
          @set-locale="locale => $emit('setLocale', locale)"
        />
        <button v-if="showColorToggle" type="button" class="per-action" @click="$emit('toggleColorMode')">
          <BIconSun v-if="colorMode === 'light'" :title="$t('switchToDarkMode')" />
          <BIconMoonStars v-else :title="$t('switchToLightMode')" />
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { defineAsyncComponent } from 'vue';
import BIconMoonStars from '~icons/bi/moon-stars';
import BIconSun from '~icons/bi/sun';
import HeaderTitle from './HeaderTitle.vue';
import StacLink from './StacLink.vue';

// Replaces the upstream `.site` row of StacBrowser.vue with one white bar:
// the municipal logo and the wordmark, which link to the home page, and the
// catalog statistics. The brand gradient is a thin rule under the bar. The
// site is one page, so the bar has no navigation: no sidebar and no search.
// Login, the language chooser and the colour toggle still pass through.
export default {
  name: 'PerHeader',
  components: {
    BIconMoonStars,
    BIconSun,
    HeaderTitle,
    LanguageChooser: defineAsyncComponent(() => import('./LanguageChooser.vue')),
    StacLink
  },
  props: {
    root: {
      type: Object,
      default: null
    },
    showRootStats: {
      type: Boolean,
      default: false
    },
    serviceType: {
      type: String,
      default: ''
    },
    canAuthenticate: {
      type: Boolean,
      default: false
    },
    authIcon: {
      type: [String, Object, Function],
      default: null
    },
    authLabel: {
      type: String,
      default: ''
    },
    authTitle: {
      type: String,
      default: ''
    },
    data: {
      type: Object,
      default: null
    },
    currentLocale: {
      type: String,
      default: 'es'
    },
    locales: {
      type: Array,
      default: () => []
    },
    showColorToggle: {
      type: Boolean,
      default: false
    },
    colorMode: {
      type: String,
      default: 'light'
    }
  },
  emits: ['logInOut', 'setLocale', 'toggleColorMode'],
  computed: {
    logo() {
      return `${import.meta.env.BASE_URL}pergamino/logo-municipalidad-tinta.svg`;
    }
  },
  methods: {
    // StacBrowser calls $refs.headerTitle.updateUrl() after each navigation.
    updateUrl() {
      if (this.$refs.headerTitle) {
        this.$refs.headerTitle.updateUrl();
      }
    }
  }
};
</script>

<style lang="scss">
@import 'bootstrap/scss/mixins';
@import "../theme/variables.scss";

// The bar spans the viewport, but sits inside a max-width b-container.
// custom.scss clips horizontal overflow on #stac-browser, so the 50vw term
// cannot add a horizontal scrollbar.
.per-header {
  margin-inline: calc(50% - 50vw);
  border-bottom: $per-rule-height solid transparent;
  border-image: $per-rule 1;
  background-color: $per-head-bg;
  color: $per-head-fg;
}

.per-inner {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  min-height: $per-head-height;
  margin-inline: auto;
  padding-inline: $block-gap;

  @include media-breakpoint-up(xxxl) {
    max-width: 75vw;
  }

  @include media-breakpoint-down(sm) {
    gap: 0.5rem;
  }
}

#stac-browser .per-brand {
  display: flex;
  align-items: center;
  gap: 1.1rem;
  min-width: 0;
  color: $per-head-fg;
  text-decoration: none;
}

.per-logo {
  flex-shrink: 0;
  height: 2rem;
  width: auto;
}

.per-wordmark {
  padding-left: 1.1rem;
  border-left: 1px solid $per-line;
  white-space: nowrap;

  .header-title {
    font-size: 1rem;
    font-weight: $per-weight-title;

    // HeaderTitle draws the root icon when the catalog has one. The municipal
    // logo already fills that place.
    .logo {
      display: none;
    }
  }

  @include media-breakpoint-down(md) {
    display: none;
  }
}

.per-tools {
  display: flex;
  margin-left: auto;
  align-items: center;
  gap: 2px;
}

#stac-browser .per-action {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0.75rem;
  border: 0;
  border-radius: $per-radius;
  background: none;
  color: $per-head-muted;
  font-size: 0.88rem;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;

  &:hover,
  &[aria-current="page"],
  &[aria-expanded="true"] {
    background-color: $per-head-hover;
    color: $per-head-fg;
  }

  @include media-breakpoint-down(sm) {
    padding: 0.5rem;
  }

  &:focus-visible {
    outline: 2px solid $per-rosa;
    outline-offset: 1px;
  }
}

.per-lang .btn {
  border: 0;
  background-color: transparent;
  color: $per-head-muted;
}

</style>
