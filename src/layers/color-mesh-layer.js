import L from 'leaflet'
import Papa from 'papaparse'
import * as PIXI from 'pixi.js'
import 'leaflet-pixi-overlay'
import { ForecastLayer } from './forecast-layer'
import { getNearestForecastTime } from 'weacast-core/common'
import { createColorMap } from 'weacast-core/client'
// import { MeshRenderer } from '../mesh-renderer'

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
        }`,`
        precision mediump float;
        varying vec4 vColor;
        uniform float alpha;

        void main() {
          gl_FragColor.rgb = vec3(vColor[0]*alpha, vColor[1]*alpha, vColor[2]*alpha);
          gl_FragColor.a = vColor[3]*alpha;
        }`, {
            alpha: this.opacity
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

      // let req = fetch('statics/UKNO2_2019_08_05_06.csv')
      let req = fetch('https://www.bliasolutions.com/UKAir2017/UKNO2_2019_08_06_06.csv')
      let self = this

      /*
      return req.then(function(response) {
          if (response.ok) {
              response.text().then(function(text) { self.setData(text) })
          }
      })
      */

      return req.then(response => { if (response.ok) { response.text().then(text => self.setData(text)) } })

      /*
      // Query data for current time
      let query = this.getQuery()
      let queries = []
      for (let element of this.forecastElements) {
          const serviceName = this.forecastModel.name + '/' + element
          queries.push(this.api.getService(serviceName).find(query))
      }

      return Promise.all(queries)
          .then(results => {
          // To be reactive directly set data after dow nload, flatten because find returns an array even if a single element is selected
              this.setData([].concat(...results))
          })
          */
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
          return isNaN(value[3]) ? accu : [ Math.min(accu[0], value[3]), Math.max(accu[1], value[3])]
      }, [csv.data[0][3], csv.data[0][3]])

      this.colorMap = createColorMap(this.options, [bounds[1], bounds[0]])

      this.pixiRoot.removeChildren()
      // this.buildMesh(csv)
      this.csv = csv
      this.baseLayer.redraw()
      ForecastLayer.prototype.setData.call(this, data)
      /*
    if (data.length > 0) {
      this.minValue = data[0].minValue
      this.maxValue = data[0].maxValue
      this.colorMap = createColorMap(this.options,
        (this.options.invertScale ? [this.maxValue, this.minValue] : [this.minValue, this.maxValue]))
      this.gridRenderer.setGridData(data[0].data)
      this.gridRenderer.setColorMap(this.colorMap)
      this.gridRenderer.setOpacity(this.options.opacity)
      this.baseLayer.redraw()
      ForecastLayer.prototype.setData.call(this, data)
    } else {
      this.gridRenderer.setGridData(null)
      this.hasData = false
    }
    */
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
        let data = this.csv
        if (data === undefined)
            return

        let position = new Float32Array(2 * (data.data.length - 4))
        let color    = new Float32Array(4 * (data.data.length - 4))
        let index    = new Uint16Array(3 * (data.data.length - 4))
        // let index = new Uint16Array(6)

        let infos = new Map()
        let lonstart = undefined
        let prevlon = undefined

        /*
        let bounds = [0, 0, 0, 0]
        let topLeft = undefined
        let topRight = undefined
        let bottomLeft = undefined
        let bottomRight = undefined
        */

        let idx = 0
        for (let row = 4; row < data.data.length; ++row) {
            let lat = data.data[row][1]
            let lon = data.data[row][2]
            let val = data.data[row][3]

            if (isNaN(lat) || isNaN(lon))
                continue

            if (lon != prevlon) {
                if (prevlon !== undefined) {
                    infos.set(prevlon, [lonstart, row-1])
                }
                lonstart = row
                prevlon  = lon
            }

            this.latLngBounds.extend([lat, lon])
            let pos = utils.latLngToLayerPoint([lat, lon])

            /*
            if (topLeft === undefined) {
                topLeft = pos
                topRight = pos
                bottomLeft = pos
                bottomRight = pos
            } else {
                if (topLeft.x >= pos.x && topLeft.y >= pos.y) {
                    topLeft = pos
                    bounds[0] = idx
                }
                if (topRight.x <= pos.x && topRight.y >= pos.y) {
                    topRight = pos
                    bounds[1] = idx
                }
                if (bottomLeft.x >= pos.x && bottomLeft.y <= pos.y) {
                    bottomLeft = pos
                    bounds[2] = idx
                }
                if (bottomRight.x <= pos.x && bottomRight.y <= pos.y) {
                    bottomRight = pos
                    bounds[3] = idx
                }
            }
            */

            position[2*(row-4)  ] = pos.x
            position[2*(row-4)+1] = pos.y
            //let value = chroma(this.nodata.color)
            let value = this.colorMap(val)
            let rgb   = value.gl()
            color[4*(row-4)  ] = rgb[0]
            color[4*(row-4)+1] = rgb[1]
            color[4*(row-4)+2] = rgb[2]
            color[4*(row-4)+3] = value.alpha()

            ++idx
        }

        /*
        index[0] = bounds[0]
        index[1] = bounds[2]
        index[2] = bounds[3]

        index[3] = bounds[0]
        index[4] = bounds[3]
        index[5] = bounds[1]
        */

        let iindex = 0
        for (let row = 4; row < data.data.length; ++row) {
            let lat = data.data[row][1]
            let lon = data.data[row][2]

            if (isNaN(lat) || isNaN(lon))
                continue

            let i = infos.get(lon-0.1)
            if (i === undefined)
                continue

            let minLat = data.data[i[0]][1]
            let maxLat = data.data[i[1]][1]

            if (lat < minLat || lat >= maxLat)
                continue

            let index0 = row;
            let index1 = i[0] + Math.trunc((lat - minLat) / 0.05)
            let index2 = index1 + 1;

            if (index1 >= idx || index2 >= idx)
                continue

            index[++iindex] = index2;
            index[++iindex] = index1;
            index[++iindex] = index0;
        }

        // trim index array
        // index.splice(iindex, index.length-iindex)

        let geometry = new PIXI.Geometry()
            .addAttribute('position', position, 2)
            .addAttribute('color', color, 4)
            .addIndex(index)
        // let state = new PIXI.State()
        //let mesh = new PIXI.Mesh(geometry, this.shader, state, PIXI.DRAW_MODES.POINTS)
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
