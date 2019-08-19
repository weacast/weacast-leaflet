import L from 'leaflet'
import Papa from 'papaparse'
import * as PIXI from 'pixi.js'
import 'leaflet-pixi-overlay'
import { ForecastLayer } from './forecast-layer'
import { getNearestForecastTime } from 'weacast-core/common'
import { createColorMap } from 'weacast-core/client'

let ColorMeshLayer = ForecastLayer.extend({

  initialize (api, options) {
    this.latLngBounds = new L.LatLngBounds()

    // Merge options with default for undefined ones
    this.options = Object.assign({
      interpolate: true,
      scale: 'OrRd',
      opacity: 0.6,
      mesh: true
    }, options)
    this.shader = PIXI.Shader.from(`
        precision mediump float;
        attribute vec2 position;
        attribute vec4 color;
        uniform mat3 translationMatrix;
        uniform mat3 projectionMatrix;
        varying vec4 vColor;

        void main() {
          vColor = color;
          gl_Position = vec4((projectionMatrix * translationMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
        }`, `
        precision mediump float;
        varying vec4 vColor;
        uniform float alpha;

        void main() {
          gl_FragColor.rgb = vec3(vColor[0]*alpha, vColor[1]*alpha, vColor[2]*alpha);
          gl_FragColor.a = vColor[3]*alpha;

        }`, {
          alpha: this.options.opacity
        })
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

    let url = ''.concat('https://www.bliasolutions.com/UKAir2017/', this.options.elements[0], `_${this.downloadedForecastTime.format('YYYY_MM_DD_HH')}`, '.csv')
    let req = fetch(url)
    let self = this

    return req.then(response => { if (response.ok) { response.text().then(text => self.setData(text)) } })
  },

  setData (data) {
    let csv = Papa.parse(data)

    // get rid of headers
    csv.data.shift()
    // turn data into float
    for (let i = 0; i < csv.data.length; ++i) {
      csv.data[i][1] = parseFloat(csv.data[i][1])
      csv.data[i][2] = parseFloat(csv.data[i][2])
      csv.data[i][3] = parseFloat(csv.data[i][3])
    }

    // compute min max over values
    let bounds = csv.data.reduce((accu, value) => {
      return isNaN(value[3]) ? accu : [Math.min(accu[0], value[3]), Math.max(accu[1], value[3])]
    }, [csv.data[0][3], csv.data[0][3]])

    this.colorMap = createColorMap(this.options, [bounds[0], bounds[1]])

    this.pixiRoot.removeChildren()
    this.csv = csv
    this.baseLayer.redraw()
    ForecastLayer.prototype.setData.call(this, data)
  },

  renderMesh (utils) {
    if (this.pixiRoot.children.length === 0) {
      this.buildMesh(utils)
    }
    let renderer = utils.getRenderer()
    renderer.render(this.pixiRoot)
  },

  getBounds () {
    return this.latLngBounds
  },

  buildMesh (utils) {
    let csv = this.csv
    if (csv === undefined) { return }

    // compute lat/lon bounds
    let latLonBounds = csv.data.reduce((accu, value) => {
      let minLat = accu[0]
      let maxLat = accu[1]
      let minLon = accu[2]
      let maxLon = accu[3]
      if (!isNaN(value[1])) {
        minLat = Math.min(minLat, value[1])
        maxLat = Math.max(maxLat, value[1])
      }
      if (!isNaN(value[2])) {
        minLon = Math.min(minLon, value[2])
        maxLon = Math.max(maxLon, value[2])
      }
      return [minLat, maxLat, minLon, maxLon]
    }, [csv.data[0][1], csv.data[0][1], csv.data[0][2], csv.data[0][2]])

    // update spatial bounds
    this.latLngBounds.extend([latLonBounds[0], latLonBounds[2]])
    this.latLngBounds.extend([latLonBounds[1], latLonBounds[3]])

    // compute grid size based on bounds
    let iLat = Math.ceil((latLonBounds[1] - latLonBounds[0]) / 0.05)
    let iLon = Math.ceil((latLonBounds[3] - latLonBounds[2]) / 0.1)

    // allocate data buffers
    let position = new Float32Array(2 * (iLat + 1) * (iLon + 1))
    let color = new Float32Array(4 * (iLat + 1) * (iLon + 1))
    let index = new Uint16Array(6 * iLat * iLon)

    // fill whole grid
    let idx = 0
    let iidx = 0
    for (let lo = 0; lo <= iLon; ++lo) {
      for (let la = 0; la <= iLat; ++la) {
        let latLon = [latLonBounds[0] + 0.05 * la, latLonBounds[2] + 0.1 * lo]
        let pos = utils.latLngToLayerPoint(latLon)
        position[idx * 2] = pos.x
        position[idx * 2 + 1] = pos.y
        color[idx * 4] = 0.0
        color[idx * 4 + 1] = 0.0
        color[idx * 4 + 2] = 0.0
        color[idx * 4 + 3] = 0.0

        if (lo !== 0 && la !== 0) {
          index[iidx++] = idx
          index[iidx++] = idx - 1
          index[iidx++] = idx - (iLat + 1)
          index[iidx++] = idx - (iLat + 1)
          index[iidx++] = idx - 1
          index[iidx++] = idx - (iLat + 2)
        }

        ++idx
      }
    }

    // fill actual data
    for (let row = 0; row < csv.data.length; ++row) {
      let lat = csv.data[row][1]
      let lon = csv.data[row][2]
      let val = csv.data[row][3]

      if (isNaN(lat) || isNaN(lon)) { continue }

      // index in grid based on lat lon
      let y = Math.ceil((lat - latLonBounds[0]) / 0.05)
      let x = Math.ceil((lon - latLonBounds[2]) / 0.1)
      let o = y + x * (iLat + 1)

      // let pos   = utils.latLngToLayerPoint([lat, lon])
      let value = this.colorMap(val)
      let rgb = value.gl()

      // position[2*o  ] = pos.x
      // position[2*o+1] = pos.y
      // let value = chroma(this.nodata.color)
      color[4 * o] = rgb[0]
      color[4 * o + 1] = rgb[1]
      color[4 * o + 2] = rgb[2]
      color[4 * o + 3] = value.alpha()
    }

    // build mesh
    let geometry = new PIXI.Geometry()
            .addAttribute('position', position, 2)
            .addAttribute('color', color, 4)
            .addIndex(index)
    // PixiJS doc says it improves slighly performances
    geometry.interleave()
    let mesh = new PIXI.Mesh(geometry, this.shader)
    this.pixiRoot.addChild(mesh)
  },

  setForecastModel (model) {
    // this.grid = new Grid(model)
    // this.gridRenderer.setGrid(this.grid)
    ForecastLayer.prototype.setForecastModel.call(this, model)
  }
})

L.weacast.ColorMeshLayer = ColorMeshLayer
L.weacast.colorMeshLayer = function (api, options) {
  return new L.weacast.ColorMeshLayer(api, options)
}
export { ColorMeshLayer }
