import L from 'leaflet'
import * as PIXI from 'pixi.js'
import 'leaflet-pixi-overlay'
import { ForecastLayer } from './forecast-layer'
import { getNearestForecastTime } from 'weacast-core/common'
import { BliaSolutionsMesh } from '../blia-solutions-mesh'

let TiledMeshLayer = L.GridLayer.extend({

  initialize (api, options) {
    // Merge options with default for undefined ones
    let localOptions = Object.assign({
      scale: 'OrRd',
      opacity: 0.6
    }, options)
    /*
    this.options = Object.assign({
      scale: 'OrRd',
      opacity: 0.6
    }, options)
    */
    // this.options = options

    this.source = new BliaSolutionsMesh()
    this.source.initialize(localOptions)
    this.onDataFetched = this.source.fetchData(null)

    // PIXI.settings.PREFER_ENV = PIXI.ENV.WEBGL

    this.pixiRoot = new PIXI.Container()
    // let pixiOverlayOptions = Object.assign({ autoPreventDefault: false }, localOptions)
    let pixiOverlayOptions = Object.assign({
      destroyInteractionManager: true,
      shouldRedrawOnMove: function() { return true }
    }, localOptions)
    let overlay = L.pixiOverlay(utils => this.renderMesh(utils), this.pixiRoot, pixiOverlayOptions)
    // ForecastLayer.prototype.initialize.call(this, api, overlay, options)
    this.baseLayer = overlay

    this.layerUniforms = new PIXI.UniformGroup({ alpha: localOptions.opacity, zoomLevel: 1.0 })

    let self = this
    this.on('tileunload', function(e) {
      self.onTileUnload(e)
    });

    this.onDataFetched.then(function(data) {
      // allow grid layer to only load tile in those bounds
      self.options.bounds = self.source.getSpatialBounds()

      /*
      const minLat = self.options.bounds.getSouth()
      const maxLat = self.options.bounds.getNorth()
      const minLon = self.options.bounds.getWest()
      const maxLon = self.options.bounds.getEast()

      self.layerUniforms.uniforms['offsetScale'] = Float32Array.from([minLat, minLon, maxLat - minLat, maxLon - minLon])
      */
    })
  },

  createTile (coords, done) {
    const tileSize = this.getTileSize()
    const pixelCoords0 = L.point(coords.x * tileSize.x, coords.y * tileSize.y)
    const pixelCoords1 = L.point(pixelCoords0.x + (tileSize.x /*- 1*/), pixelCoords0.y + (tileSize.y /*- 1*/))
    const latLonCoords0 = this.map.wrapLatLng(this.map.unproject(pixelCoords0, coords.z))
    const latLonCoords1 = this.map.wrapLatLng(this.map.unproject(pixelCoords1, coords.z))

    var tile = document.createElement('div');
    /*
		tile.innerHTML = [latLonCoords0.lat, latLonCoords0.lng].join(', ');
		tile.style.outline = '1px solid red';
    */

    let self = this
    this.onDataFetched.then(function(data) {
      const minLat = Math.min(latLonCoords0.lat, latLonCoords1.lat)
      const maxLat = Math.max(latLonCoords0.lat, latLonCoords1.lat)
      const minLon = Math.min(latLonCoords0.lng, latLonCoords1.lng)
      const maxLon = Math.max(latLonCoords0.lng, latLonCoords1.lng)
      self.source.buildBoundedMesh(minLat, minLon, maxLat, maxLon, self.layerUniforms).then(function(mesh) {
        if (mesh !== undefined) {
          tile.mesh = mesh
          self.pixiRoot.addChild(mesh)
          self.baseLayer.redraw()
        }
        done(null, tile)
      })
    })

    return tile
  },

  onAdd (map) {
    this.map = map
    map.addLayer(this.baseLayer)
    L.GridLayer.prototype.onAdd.call(this, map)
  },

  onRemove (map) {
    this.map = undefined
    map.removeLayer(this.baseLayer)
    L.GridLayer.prototype.onRemove.call(this, map)
  },

  onTileUnload (e) {
    if (e.tile.mesh !== undefined) {
      this.pixiRoot.removeChild(e.tile.mesh)
    }
  },

  renderMesh (utils) {
    this.layerUniforms.uniforms.zoomLevel = this.baseLayer._initialZoom
    let renderer = utils.getRenderer()
    renderer.render(this.pixiRoot)
  },

  setForecastModel(model) {

  }
})

L.weacast.TiledMeshLayer = TiledMeshLayer
L.weacast.tiledMeshLayer = function (api, options) {
  return new L.weacast.TiledMeshLayer(api, options)
}
export { TiledMeshLayer }
