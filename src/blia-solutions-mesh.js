import L from 'leaflet'
import * as PIXI from 'pixi.js'
import Papa from 'papaparse'
import { createColorMap } from 'weacast-core/client'

export class BliaSolutionsMesh {
  constructor () {
    this.options = undefined
    this.data = undefined
    this.dataBounds = undefined
    this.shader = undefined

    this.mesh = undefined
    this.colormap = undefined
    this.latLngBounds = undefined
  }

  initialize (options) {
    this.options = options

    // make sure options has the required fields
    //  opacity (shader)
    //  scale (colormap)
    //  elements[0] (fetch url)

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
          if (vColor.a != 1.0)
            discard;

          gl_FragColor.rgb = vec3(vColor[0]*alpha, vColor[1]*alpha, vColor[2]*alpha);
          gl_FragColor.a = alpha;

        }`, {
          alpha: this.options.opacity
        })
  }

  async fetchData (moment) {
    const url = ''.concat('https://www.bliasolutions.com/UKAir2017/'
                          , this.options.elements[0]
                          , `_${moment.format('YYYY_MM_DD_HH')}.csv`)
    const req = await window.fetch(url)
    const txt = await req.text()

    const csv = Papa.parse(txt)

    // get rid of headers
    csv.data.shift()
    // turn data into float
    for (let i = 0; i < csv.data.length; ++i) {
      csv.data[i][1] = parseFloat(csv.data[i][1])
      csv.data[i][2] = parseFloat(csv.data[i][2])
      csv.data[i][3] = parseFloat(csv.data[i][3])
    }

    return csv
  }

  setData (csv) {
    // compute bounds
    const bounds = csv.data.reduce((accu, value) => {
      let minLat = accu[0]
      let maxLat = accu[1]
      let minLon = accu[2]
      let maxLon = accu[3]
      let minVal = accu[4]
      let maxVal = accu[5]
      if (!isNaN(value[1])) {
        minLat = Math.min(minLat, value[1])
        maxLat = Math.max(maxLat, value[1])
      }
      if (!isNaN(value[2])) {
        minLon = Math.min(minLon, value[2])
        maxLon = Math.max(maxLon, value[2])
      }
      if (!isNaN(value[3])) {
        minVal = Math.min(minVal, value[3])
        maxVal = Math.max(maxVal, value[3])
      }
      return [minLat, maxLat, minLon, maxLon, minVal, maxVal]
    }, [csv.data[0][1], csv.data[0][1], csv.data[0][2], csv.data[0][2], csv.data[0][3], csv.data[0][3]])

    // build colormap
    this.colorMap = createColorMap(this.options, [bounds[4], bounds[5]])

    // update spatial bounds
    this.latLngBounds = new L.LatLngBounds()
    this.latLngBounds.extend([bounds[0], bounds[2]])
    this.latLngBounds.extend([bounds[1], bounds[3]])

    this.data = csv
    this.dataBounds = bounds
  }

  getColorMap () {
    return this.colorMap
  }

  getSpatialBounds () {
    return this.latLngBounds
  }

  buildMesh (utils) {
    const csv = this.data
    if (csv === undefined) { return }

    const bounds = this.dataBounds

    // compute grid size based on bounds
    const iLat = Math.ceil((bounds[1] - bounds[0]) / 0.05)
    const iLon = Math.ceil((bounds[3] - bounds[2]) / 0.1)

    // allocate data buffers
    const position = new Float32Array(2 * (iLat + 1) * (iLon + 1))
    const color = new Uint8Array(4 * (iLat + 1) * (iLon + 1))
    const index = new Uint16Array(6 * iLat * iLon)

    // fill whole grid
    let idx = 0
    let iidx = 0
    for (let lo = 0; lo <= iLon; ++lo) {
      for (let la = 0; la <= iLat; ++la) {
        const latLon = [bounds[0] + 0.05 * la, bounds[2] + 0.1 * lo]
        const pos = utils.latLngToLayerPoint(latLon)
        position[idx * 2] = pos.x
        position[idx * 2 + 1] = pos.y

        if (lo !== 0 && la !== 0) {
          index[iidx++] = idx
          index[iidx++] = idx - (iLat + 1)
          index[iidx++] = idx - 1
          index[iidx++] = idx - (iLat + 1)
          index[iidx++] = idx - (iLat + 2)
          index[iidx++] = idx - 1
        }

        ++idx
      }
    }

    // fill actual data
    for (let row = 0; row < csv.data.length; ++row) {
      const lat = csv.data[row][1]
      const lon = csv.data[row][2]
      const val = csv.data[row][3]

      if (isNaN(lat) || isNaN(lon)) { continue }

      // index in grid based on lat lon
      const y = Math.ceil((lat - bounds[0]) / 0.05)
      const x = Math.ceil((lon - bounds[2]) / 0.1)
      const o = y + x * (iLat + 1)

      const mapped = this.colorMap(val)
      const rgb = mapped.rgb()
      color[4 * o] = rgb[0]
      color[4 * o + 1] = rgb[1]
      color[4 * o + 2] = rgb[2]
      color[4 * o + 3] = 255
    }

    // build mesh
    let geometry = new PIXI.Geometry()
        .addAttribute('position', position, 2)
        .addAttribute('color', color, 4, true, PIXI.TYPES.UNSIGNED_BYTE)
        .addIndex(index)
    // PixiJS doc says it improves slighly performances
    // fails when using normalized UNSIGNED_BYTE color attribute
    //geometry.interleave()
    const state = new PIXI.State()
    state.culling = true
    state.blendMode = PIXI.BLEND_MODES.SCREEN
    this.mesh = new PIXI.Mesh(geometry, this.shader, state)

    // get rid of csv
    this.data = undefined
  }

  getMesh () {
    return this.mesh
  }
}
