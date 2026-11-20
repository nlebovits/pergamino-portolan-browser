<template>
  <button type="button" class="map-zoomincontrol" @click="$emit('zoom', minZoom)">
    {{ $t('mapping.zoomIn', { zoom: minZoom }) }}
  </button>
</template>

<script>
// Says that the data starts at a closer zoom, and zooms there on a click.
// MapView shows it while the map is below the data's minimum zoom.
export default {
  name: 'ZoomInControl',
  props: {
    minZoom: {
      type: Number,
      required: true
    }
  },
  emits: ['zoom']
};
</script>

<style lang="scss" scoped>
.map-zoomincontrol {
  position: absolute;
  top: 10px;
  left: 50px;
  max-width: calc(100% - 120px);
  box-sizing: border-box;
  border: 0;
  border-radius: 4px;
  padding: 0.2em 0.5em;
  background-color: rgba(255, 255, 255, 0.85);
  color: inherit;
  font-size: 0.9em;
  text-align: center;
  text-decoration: underline;
  z-index: 2;
  cursor: pointer;
}
</style>
