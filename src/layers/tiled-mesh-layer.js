import L from 'leaflet'
import * as PIXI from 'pixi.js'
import 'leaflet-pixi-overlay'
import { ForecastLayer } from './forecast-layer'
import { getNearestForecastTime } from 'weacast-core/common'
import { BliaSolutionsMesh } from '../blia-solutions-mesh'

let TiledMeshLayer = L.GridLayer.extend({

  initialize (api, options) {
    // Merge options with default for undefined ones
    /*
    this.options = Object.assign({
      scale: 'OrRd',
      opacity: 0.6
    }, options)
    */

    /*
    this.source = new BliaSolutionsMesh()
    this.source.initialize(this.options)
    */

    this.pixiRoot = new PIXI.Container()
    let pixiOverlayOptions = Object.assign({ autoPreventDefault: false }, options)
    let overlay = L.pixiOverlay(utils => this.renderMesh(utils), this.pixiRoot, pixiOverlayOptions)
    // ForecastLayer.prototype.initialize.call(this, api, overlay, options)
    this.baseLayer = overlay

    let self = this;
    this.on('tileunload', function(e) {
      self.onTileUnload(e)
    });
  },

  createTile (coords) {
    var tile = document.createElement('div');
		tile.innerHTML = [coords.x, coords.y, coords.z].join(', ');
		tile.style.outline = '1px solid red';
		return tile;
  },

  /*
  onAdd (map) {
    // map.addLayer(this.baseLayer)
    // L.GridLayer.prototype.onAdd.call(this, map)
  },

  onRemove (map) {
    // map.removeLayer (this.baseLayer)
    // L.GridLayer.prototype.onRemove.call(this, map)
  },
  */

  onTileUnload (e) {
    
  },

  renderMesh (utils) {
    /*
    if (this.pixiRoot.children.length === 0) {
      this.source.buildMesh(utils)
      const mesh = this.source.getMesh()
      if (mesh !== undefined) {
        this.pixiRoot.addChild(mesh)
      }
    }
    let renderer = utils.getRenderer()
    renderer.render(this.pixiRoot)
    */
  },

  setForecastModel(model) {

  }
})

L.weacast.TiledMeshLayer = TiledMeshLayer
L.weacast.tiledMeshLayer = function (api, options) {
  return new L.weacast.TiledMeshLayer(api, options)
}
export { TiledMeshLayer }
