import L from 'leaflet'
import * as PIXI from 'pixi.js'
import 'leaflet-pixi-overlay'
import { ForecastLayer } from './forecast-layer'
import { getNearestForecastTime } from 'weacast-core/common'
import { BliaSolutionsMesh } from '../blia-solutions-mesh'

let MeshLayer = ForecastLayer.extend({

  initialize (api, options) {
    // Merge options with default for undefined ones
    this.options = Object.assign({
      scale: 'OrRd',
      opacity: 0.6
    }, options)

    this.source = new BliaSolutionsMesh()
    this.source.initialize(this.options)

    this.pixiRoot = new PIXI.Container()
    let pixiOverlayOptions = Object.assign({ autoPreventDefault: false }, options)
    let overlay = L.pixiOverlay(utils => this.renderMesh(utils), this.pixiRoot, pixiOverlayOptions)
    ForecastLayer.prototype.initialize.call(this, api, overlay, options)
  },

  fetchData () {
    // Not yet ready
    if (!this.forecastModel || !this.api.getForecastTime()) return
    // Find nearest available data
    this.currentForecastTime = getNearestForecastTime(this.api.getForecastTime(), this.forecastModel.interval)
    // Already up-to-date ?
    if (this.downloadedForecastTime && this.downloadedForecastTime.isSame(this.currentForecastTime)) return
    this.downloadedForecastTime = this.currentForecastTime.clone()

    const self = this
    this.source.fetchData(this.downloadedForecastTime).then(data => self.setData(data))
  },

  setData (data) {
    this.pixiRoot.removeChildren()
    this.source.setData(data)
    this.colorMap = this.source.getColorMap()
    this.baseLayer.redraw()
    ForecastLayer.prototype.setData.call(this, data)
  },

  renderMesh (utils) {
    if (this.pixiRoot.children.length === 0) {
      const mesh = this.source.buildMesh(utils)
      this.source.shader.uniforms.zoomLevel = this.baseLayer._initialZoom
      if (mesh !== undefined) {
        this.pixiRoot.addChild(mesh)
      }
    }
    let renderer = utils.getRenderer()
    renderer.render(this.pixiRoot)
  },

  getBounds () {
    return this.source.getSpatialBounds()
  }
})

L.weacast.MeshLayer = MeshLayer
L.weacast.meshLayer = function (api, options) {
  return new L.weacast.MeshLayer(api, options)
}
export { MeshLayer }
