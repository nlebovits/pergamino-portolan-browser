import { defineAsyncComponent } from 'vue';

// IDE Pergamino: the footer with the demo notice, the contact details of the
// Municipalidad, and the links. Its content lives in home.config.js.
export default {
  'footer-start': [
    {
      id: 'PerFooter',
      component: defineAsyncComponent(() => import('./src/components/PerFooter.vue'))
    }
  ]
};
