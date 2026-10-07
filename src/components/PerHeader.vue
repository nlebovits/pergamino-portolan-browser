<template>
  <div class="per-header site">
    <div class="per-bar">
      <div class="per-inner">
        <component :is="root ? 'StacLink' : 'div'" v-bind="root ? { data: root } : {}" class="per-brand">
          <img :src="logo" :alt="$t('pergamino.logoAlt')" class="per-logo">
          <span class="per-wordmark">
            <HeaderTitle ref="headerTitle" />
            <span class="per-subtitle">{{ $t('pergamino.subtitle') }}</span>
          </span>
        </component>

        <nav class="per-user">
          <button v-if="canAuthenticate" type="button" class="per-plain" :title="authTitle" @click="$emit('logInOut')">
            <component :is="authIcon" /><span class="per-label">{{ authLabel }}</span>
          </button>
          <LanguageChooser
            v-if="locales.length > 1"
            class="per-lang"
            :data="data" :currentLocale="currentLocale" :locales="locales"
            @set-locale="locale => $emit('setLocale', locale)"
          />
          <button v-if="showColorToggle" type="button" class="per-plain" @click="$emit('toggleColorMode')">
            <BIconSun v-if="colorMode === 'light'" :title="$t('switchToDarkMode')" />
            <BIconMoonStars v-else :title="$t('switchToLightMode')" />
          </button>
        </nav>
      </div>
    </div>

    <div v-if="!isServerSelector || canSearch || showRootStats" class="per-band">
      <nav class="per-inner per-actions">
        <button
          v-if="!isServerSelector" type="button" class="per-action"
          :aria-expanded="menuOpen ? 'true' : 'false'" :title="$t('browse')"
          @click="$emit('toggleSidebar')"
        >
          <BIconList /><span class="per-label">{{ $t('pergamino.browse') }}</span>
        </button>
        <router-link
          v-if="canSearch" :to="searchLink" class="per-action"
          :class="{ active: isSearchPage }" :title="$t('search.title')"
        >
          <BIconSearch /><span class="per-label">{{ $t('pergamino.search') }}</span>
        </router-link>
        <button v-if="showRootStats" id="popover-root-btn" type="button" class="per-action per-stats" tabindex="0">
          <BIconDatabase /><span class="per-label">{{ serviceType }}</span>
        </button>
      </nav>
    </div>
  </div>
</template>

<script>
import { defineAsyncComponent } from 'vue';
import BIconDatabase from '~icons/bi/database';
import BIconList from '~icons/bi/list';
import BIconMoonStars from '~icons/bi/moon-stars';
import BIconSearch from '~icons/bi/search';
import BIconSun from '~icons/bi/sun';
import HeaderTitle from './HeaderTitle.vue';
import StacLink from './StacLink.vue';

// Replaces the upstream `.site` row of StacBrowser.vue. Every prop and event of
// that row passes through here unchanged, so search, the sidebar, login, the
// language chooser, the colour toggle and the root statistics popover still work.
export default {
  name: 'PerHeader',
  components: {
    BIconDatabase,
    BIconList,
    BIconMoonStars,
    BIconSearch,
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
    canSearch: {
      type: Boolean,
      default: false
    },
    isSearchPage: {
      type: Boolean,
      default: false
    },
    searchLink: {
      type: [String, Object],
      default: '/search'
    },
    isServerSelector: {
      type: Boolean,
      default: false
    },
    menuOpen: {
      type: Boolean,
      default: false
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
  emits: ['toggleSidebar', 'logInOut', 'setLocale', 'toggleColorMode'],
  computed: {
    logo() {
      return `${import.meta.env.BASE_URL}pergamino/logo-municipalidad-blanco.svg`;
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

.per-header {
  // The header sits inside a max-width b-container, but both strips span the
  // viewport. page.scss clips horizontal overflow on #stac-browser, so the
  // 50vw term cannot add a horizontal scrollbar.
  margin-inline: calc(50% - 50vw);
}

.per-inner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-inline: auto;
  padding-inline: $block-gap;

  @include media-breakpoint-up(xxxl) {
    max-width: 75vw;
  }
}

// The GeoNode brand bar: the yellow to pink gradient with the white municipal logo.
.per-bar {
  background: $per-gradient;

  .per-inner {
    min-height: $per-bar-height;
  }
}

.per-brand {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  min-width: 0;
  color: $per-ink;
  text-decoration: none;

  &:hover,
  &:focus {
    color: $per-ink;
    text-decoration: none;
  }
}

.per-logo {
  flex-shrink: 0;
  height: 2.6rem;
  width: auto;

  @include media-breakpoint-down(sm) {
    height: 2rem;
  }
}

.per-wordmark {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding-left: 0.85rem;
  border-left: 1px solid rgba($per-ink, 0.35);
  line-height: 1.15;

  .header-title {
    font-size: 1.35rem;
    font-weight: $per-weight-title;

    // HeaderTitle draws the root icon when the catalog has one. The municipal
    // logo already fills that place.
    .logo {
      display: none;
    }
  }

  @include media-breakpoint-down(sm) {
    padding-left: 0.6rem;

    .header-title {
      font-size: 1.05rem;
    }
  }
}

.per-subtitle {
  font-size: 0.8rem;
  font-weight: 400;

  @include media-breakpoint-down(md) {
    display: none;
  }
}

.per-user {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: auto;
}

.per-plain {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.6rem;
  border: 0;
  border-radius: $per-radius;
  background: none;
  color: $per-ink;
  font-weight: $per-weight-label;

  &:hover,
  &:focus-visible {
    background-color: rgba(white, 0.35);
  }
}

.per-lang .btn {
  border: 0;
  background-color: transparent;
  color: $per-ink;
  font-weight: $per-weight-label;
}

// The GeoNode #gn-topbar strip: dark ink, white 600-weight labels, lighter on hover.
.per-band {
  background-color: $per-ink;
}

.per-actions {
  gap: 0;
  min-height: $per-band-height;
}

.per-action {
  display: flex;
  align-items: center;
  align-self: stretch;
  gap: 0.45rem;
  padding: 0 0.85rem;
  border: 0;
  background-color: $per-ink;
  color: white;
  font-weight: $per-weight-label;
  text-decoration: none;
  white-space: nowrap;

  &:hover,
  &:focus-visible,
  &.active {
    background-color: $per-ink-hover;
    color: white;
    text-decoration: none;
  }

  &:focus-visible {
    outline: 2px solid $per-gradient-start;
    outline-offset: -3px;
  }
}

.per-stats {
  margin-left: auto;
}

.per-label {
  @include media-breakpoint-down(sm) {
    .per-plain & {
      display: none;
    }
  }
}
</style>
