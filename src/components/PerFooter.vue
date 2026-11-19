<template>
  <div v-if="footer" class="per-footer">
    <div class="per-footer-grid">
      <div v-if="contact" class="per-footer-contact">
        <img :src="logo" :alt="$t('pergamino.logoAlt')" class="per-footer-logo">
        <h2>{{ $t('pergamino.footer.contact') }}</h2>
        <ul>
          <li v-if="contact.address">
            <a v-if="contact.addressUrl" :href="contact.addressUrl" target="_blank" rel="noopener noreferrer">{{ contact.address }}</a>
            <template v-else>{{ contact.address }}</template>
          </li>
          <li v-if="contact.phone"><a :href="contact.phoneUrl">{{ contact.phone }}</a></li>
          <li v-if="contact.email"><a :href="`mailto:${contact.email}`">{{ contact.email }}</a></li>
        </ul>
      </div>
      <nav v-for="column in columns" :key="column.title" :aria-label="column.title">
        <h2>{{ column.title }}</h2>
        <ul :class="{ 'per-footer-icons': column.links.every(link => icons[link.icon]) }">
          <li v-for="link in column.links" :key="link.url">
            <a :href="link.url" target="_blank" rel="noopener noreferrer" :aria-label="icons[link.icon] ? link.label : null" :title="icons[link.icon] ? link.label : null">
              <component :is="icons[link.icon]" v-if="icons[link.icon]" aria-hidden="true" />
              <template v-else>{{ link.label }}</template>
            </a>
          </li>
        </ul>
      </nav>
    </div>
  </div>
</template>

<script>
import { markRaw } from 'vue';
import BrandFacebook from '~icons/bi/facebook';
import BrandInstagram from '~icons/bi/instagram';
import BrandTiktok from '~icons/bi/tiktok';
import BrandX from '~icons/bi/twitter-x';
import BrandYoutube from '~icons/bi/youtube';
import homeConfig from '../../home.config';

// The brand marks of the social networks, by the `icon` key of a footer link.
const ICONS = markRaw({
  facebook: BrandFacebook,
  instagram: BrandInstagram,
  tiktok: BrandTiktok,
  x: BrandX,
  youtube: BrandYoutube
});

// The footer of every page: the contact details of the Municipalidad and the
// link columns. widgets.config.js mounts
// it at the upstream `footer-start` hook. home.config.js holds its content.
export default {
  name: 'PerFooter',
  data() {
    return {
      footer: homeConfig.footer || null,
      icons: ICONS
    };
  },
  computed: {
    contact() {
      return this.footer?.contact || null;
    },
    columns() {
      return Array.isArray(this.footer?.columns) ? this.footer.columns.filter(c => Array.isArray(c.links) && c.links.length > 0) : [];
    },
    logo() {
      return `${import.meta.env.BASE_URL}pergamino/logo-municipalidad-tinta.svg`;
    }
  }
};
</script>

<style lang="scss">
@import 'bootstrap/scss/mixins';
@import "../theme/variables.scss";

#stac-browser .per-footer {
  margin-bottom: 1.5rem;
  text-align: left;

  h2 {
    margin: 0 0 0.6rem;
    color: $per-ink;
    font-size: 0.8rem;
    font-weight: $per-weight-title;
    letter-spacing: 0;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    padding: 0.15rem 0;
  }
}

.per-footer-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) repeat(3, minmax(0, 1fr));
  gap: 1.5rem 2rem;

  @include media-breakpoint-down(lg) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @include media-breakpoint-down(sm) {
    grid-template-columns: minmax(0, 1fr);
  }
}

// A row of brand marks in place of a list of names.
#stac-browser .per-footer-icons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;

  li {
    padding: 0;
  }

  a {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border: 1px solid $per-line;
    border-radius: 50%;
    background-color: $per-paper;
    color: $per-ink-soft;
    font-size: 1rem;

    &:hover,
    &:focus-visible {
      border-color: $per-rosa;
      color: $per-ink;
    }
  }
}

.per-footer-logo {
  display: block;
  height: 1.75rem;
  width: auto;
  margin-bottom: 1rem;
}
</style>
