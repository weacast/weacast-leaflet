import L from 'leaflet'
import * as PIXI from 'pixi.js'
import Papa from 'papaparse'
import { createColorMap } from 'weacast-core/client'

const vtxShaderSrc = `
  precision mediump float;

  attribute vec2 position;
  attribute vec4 color;
  uniform mat3 translationMatrix;
  uniform mat3 projectionMatrix;
  uniform float zoomLevel;
  uniform vec4 offsetScale;
  varying vec4 vColor;
  varying vec2 vLatLon;

  vec2 ConvertCoordinates(vec3 latLonZoom) {
    const float d = 3.14159265359 / 180.0;
    const float maxLat = 85.0511287798;     // max lat using Web Mercator, used by EPSG:3857 CRS
    const float R = 6378137.0;              // earth radius

    // project
    // float lat = max(min(maxLat, latLonZoom[0]), -maxLat);
    float lat = clamp(latLonZoom[0], -maxLat, maxLat);
    float sla = sin(lat * d);
    vec2 point = vec2(R * latLonZoom[1] * d, R * log((1.0 + sla) / (1.0 - sla)) / 2.0);

    // scale
    float scale = 256.0 * pow(2.0, latLonZoom[2]);

    // transform
    const float s = 0.5 / (3.14159265359 * R);
    const vec4 abcd = vec4(s, 0.5, -s, 0.5);

    return scale * ((point * abcd.xz) + abcd.yw);
  }

  void main() {
    vColor = color;
    vLatLon = offsetScale.xy + position.xy * offsetScale.zw;
    // vLatLon = position.xy;
    vec2 projected = ConvertCoordinates(vec3(vLatLon, zoomLevel));
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(projected, 1.0)).xy, 0.0, 1.0);
  }`

const frgShaderSrc = `
  precision mediump float;

  varying vec4 vColor;
  varying vec2 vLatLon;
  uniform float alpha;
  uniform vec4 latLonBounds;

  void main() {
    bvec4 outside = bvec4(lessThan(vLatLon, latLonBounds.xy), greaterThan(vLatLon, latLonBounds.zw));
    if (any(outside) || vColor.a != 1.0)
      discard;

    gl_FragColor.rgb = vec3(vColor[0]*alpha, vColor[1]*alpha, vColor[2]*alpha);
    gl_FragColor.a = alpha;
  }`

/*
  https://github.com/Leaflet/Leaflet/blob/master/src/geo/projection/Projection.SphericalMercator.js
  https://github.com/Leaflet/Leaflet/blob/master/src/geo/crs/CRS.EPSG3857.js
  https://github.com/Leaflet/Leaflet/blob/master/src/geo/crs/CRS.js
  https://github.com/Leaflet/Leaflet/blob/master/src/geometry/Transformation.js
  https://github.com/Leaflet/Leaflet/blob/master/src/map/Map.js

project: function (latlng) {
		var d = Math.PI / 180,
		    max = this.MAX_LATITUDE,
		    lat = Math.max(Math.min(max, latlng.lat), -max),
		    sin = Math.sin(lat * d);

		return new Point(
			this.R * latlng.lng * d,
			this.R * Math.log((1 + sin) / (1 - sin)) / 2);
},

_transform: function (point, scale) {
		scale = scale || 1;
		point.x = scale * (this._a * point.x + this._b);
		point.y = scale * (this._c * point.y + this._d);
		return point;
},

transformation: (function () {
		var scale = 0.5 / (Math.PI * SphericalMercator.R);
		return toTransformation(scale, 0.5, -scale, 0.5);
}())

	scale: function (zoom) {
		return 256 * Math.pow(2, zoom);
},

	latLngToPoint: function (latlng, zoom) {
		var projectedPoint = this.projection.project(latlng),
		    scale = this.scale(zoom);

		return this.transformation._transform(projectedPoint, scale);
},

  project: function (latlng, zoom) {
		zoom = zoom === undefined ? this._zoom : zoom;
		return this.options.crs.latLngToPoint(toLatLng(latlng), zoom);
},

  latLngToLayerPoint: function (latlng) {
		var projectedPoint = this.project(toLatLng(latlng))._round();
		return projectedPoint._subtract(this.getPixelOrigin());
},

https://github.com/manubb/Leaflet.PixiOverlay/blob/master/L.PixiOverlay.js#L139
latLngToLayerPoint: function (latLng, zoom) {
					zoom = (zoom === undefined) ? _layer._initialZoom : zoom;
					var projectedPoint = map.project(L.latLng(latLng), zoom);
					return projectedPoint;
},
  */

var toHalf = (function() {

   var floatView = new Float32Array(1);
   var int32View = new Int32Array(floatView.buffer);

   /* This method is faster than the OpenEXR implementation (very often
    * used, eg. in Ogre), with the additional benefit of rounding, inspired
    * by James Tursa?s half-precision code. */
   return function toHalf(val) {

     floatView[0] = val;
     var x = int32View[0];

     var bits = (x >> 16) & 0x8000; /* Get the sign */
     var m = (x >> 12) & 0x07ff; /* Keep one extra bit for rounding */
     var e = (x >> 23) & 0xff; /* Using int is faster here */

     /* If zero, or denormal, or exponent underflows too much for a denormal
      * half, return signed zero. */
     if (e < 103) {
       return bits;
     }

     /* If NaN, return NaN. If Inf or exponent overflow, return Inf. */
     if (e > 142) {
       bits |= 0x7c00;
       /* If exponent was 0xff and one mantissa bit was set, it means NaN,
        * not Inf, so make sure we set one mantissa bit too. */
       bits |= ((e == 255) ? 0 : 1) && (x & 0x007fffff);
       return bits;
     }

     /* If exponent underflows but not too much, return a denormal */
     if (e < 113) {
       m |= 0x0800;
       /* Extra rounding may overflow and set mantissa to 0 and exponent
        * to 1, which is OK. */
       bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
       return bits;
     }

     bits |= ((e - 112) << 10) | (m >> 1);
     /* Extra rounding. An overflow will set mantissa to 0 and increment
      * the exponent, which is OK. */
     bits += m & 1;
     return bits;
   };

}());

export class BliaSolutionsMesh {
  constructor () {
    this.options = undefined
    this.data = undefined
    this.dataBounds = undefined
    this.program = undefined
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

    this.program = new PIXI.Program(vtxShaderSrc, frgShaderSrc, 'blia-mesh-render')
  }

  async fetchData (moment) {
    /*
    const url = ''.concat('https://www.bliasolutions.com/UKAir2017/'
                          , this.options.elements[0]
                          , `_${moment.format('YYYY_MM_DD_HH')}.csv`)
                          */
    const url = 'statics/UKNO2_2019_07_24_18.csv'
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

    this.setData(csv)

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

    /* perform a few stat computations */
    /*
    const iLat = Math.ceil((bounds[1] - bounds[0]) / 0.05)
    const iLon = Math.ceil((bounds[3] - bounds[2]) / 0.1)
    const vertexCount = (iLat + 1) * (iLon + 1)
    const indexCount = 6 * iLat * iLon
    const coords32Bytes = 4 * 2 * vertexCount
    const coords16Bytes = 2 * 2 * vertexCount
    const colorBytes = 1 * 4 * vertexCount
    const indexBytes = 2 * indexCount
    const total32 = coords32Bytes + colorBytes + indexBytes
    const total16 = coords16Bytes + colorBytes + indexBytes
    console.log(`mesh stats:`)
    console.log(`\t${vertexCount} vertices ${indexCount} indices`)
    console.log(`\tcoords32=${coords32Bytes / 1024} coords16=${coords16Bytes / 1024} color=${colorBytes / 1024} index=${indexBytes / 1024}`)
    console.log(`\twhole mesh using float32=${total32 / 1024} using float16=${total16 / 1024}`)
    */
    /**/
  }

  getColorMap () {
    return this.colorMap
  }

  getSpatialBounds () {
    return this.latLngBounds
  }

  buildMesh (utils, layerUniforms) {
    const bounds = this.dataBounds
    if (bounds === undefined) { return }

    // compute grid size based on bounds
    const iLat = Math.ceil((bounds[1] - bounds[0]) / 0.05)
    const iLon = Math.ceil((bounds[3] - bounds[2]) / 0.1)

    const mesh = this.buildSubMesh(0, iLat, 0, iLon, layerUniforms)

    // get rid of csv
    this.data = undefined

    return mesh
  }

  async buildBoundedMesh (minLat, minLon, maxLat, maxLon, layerUniforms) {
    const bounds = this.dataBounds
    if (bounds === undefined) { return }

    // max coordinate index in the mesh
    const maxiLat = Math.ceil((bounds[1] - bounds[0]) / 0.05)
    const maxiLon = Math.ceil((bounds[3] - bounds[2]) / 0.1)

    // compute coordinates indices
    let iMinLat = Math.floor(((minLat - bounds[0]) / 0.05) - 1.0)
    let iMinLon = Math.floor(((minLon - bounds[2]) / 0.1) - 1.0)
    let iMaxLat = Math.ceil(((maxLat - bounds[0]) / 0.05) + 1.0)
    let iMaxLon = Math.ceil(((maxLon - bounds[2]) / 0.1) + 1.0)

    // clamp indices
    iMinLat = Math.min(Math.max(iMinLat, 0), maxiLat)
    iMinLon = Math.min(Math.max(iMinLon, 0), maxiLon)
    iMaxLat = Math.min(Math.max(iMaxLat, 0), maxiLat)
    iMaxLon = Math.min(Math.max(iMaxLon, 0), maxiLon)

    let mesh = undefined
    if (iMaxLat > iMinLat && iMaxLon > iMinLon) {
      mesh = this.buildSubMesh(iMinLat, iMaxLat, iMinLon, iMaxLon, layerUniforms)
      mesh.shader.uniforms.latLonBounds = Float32Array.from([minLat, minLon, maxLat, maxLon])
    }

    return mesh
  }

  buildSubMesh (fromLat, toLat, fromLon, toLon, layerUniforms) {
    const csv = this.data
    if (csv === undefined) { return undefined }

    const bounds = this.dataBounds

    const minLat = bounds[0] + 0.05 * fromLat
    const maxLat = bounds[0] + 0.05 * toLat
    const minLon = bounds[2] + 0.1  * fromLon
    const maxLon = bounds[2] + 0.1  * toLon

    // compute grid size based on bounds
    const iLat = toLat - fromLat
    const iLon = toLon - fromLon

    // allocate data buffers
    // const position = new Float32Array(2 * (iLat + 1) * (iLon + 1))
    const position = new Uint16Array(2 * (iLat + 1) * (iLon + 1))
    const color = new Uint8Array(4 * (iLat + 1) * (iLon + 1))
    const index = new Uint16Array(6 * iLat * iLon)

    // fill grid
    let vidx = 0
    let iidx = 0
    for (let lo = 0; lo <= iLon; ++lo) {
      for (let la = 0; la <= iLat; ++la) {
        /*
        position[vidx * 2] = minLat + (0.05 * la)
        position[vidx * 2 + 1] = minLon + (0.1 * lo)
        */
        /*
        position[vidx * 2] = la / iLat
        position[vidx * 2 + 1] = lo / iLon
        */
        position[vidx * 2] = toHalf(la / iLat)
        position[vidx * 2 + 1] = toHalf(lo / iLon)

        if (lo !== 0 && la !== 0) {
          index[iidx++] = vidx
          index[iidx++] = vidx - (iLat + 1)
          index[iidx++] = vidx - 1
          index[iidx++] = vidx - (iLat + 1)
          index[iidx++] = vidx - (iLat + 2)
          index[iidx++] = vidx - 1
        }

        ++vidx
      }
    }

    // fill actual data
    for (let row = 0; row < csv.data.length; ++row) {
      const lat = csv.data[row][1]
      const lon = csv.data[row][2]

      if (isNaN(lat) || isNaN(lon)) { continue }
      if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) { continue }

      // index in grid based on lat lon
      const y = Math.round((lat - minLat) / 0.05)
      const x = Math.round((lon - minLon) / 0.1)
      const o = y + x * (iLat + 1)

      const val = csv.data[row][3]
      const mapped = this.colorMap(val)
      const rgb = mapped.rgb()
      color[4 * o] = rgb[0]
      color[4 * o + 1] = rgb[1]
      color[4 * o + 2] = rgb[2]
      color[4 * o + 3] = 255
    }

    // build mesh
    let geometry = new PIXI.Geometry()
        .addAttribute('position', position, 2, false, 0x140b /*PIXI.TYPES.HALF_FLOAT*/)
        .addAttribute('color', color, 4, true, PIXI.TYPES.UNSIGNED_BYTE)
        .addIndex(index)
    // PixiJS doc says it improves slighly performances
    // fails when using normalized UNSIGNED_BYTE color attribute
    //geometry.interleave()
    const state = new PIXI.State()
    state.culling = true
    state.blendMode = PIXI.BLEND_MODES.SCREEN
    const uniforms = {
      latLonBounds: Float32Array.from([minLat, minLon, maxLat, maxLon]),
      offsetScale: Float32Array.from([minLat, minLon, maxLat - minLat, maxLon - minLon]),
      layerUniforms: layerUniforms
    }
    const shader = new PIXI.Shader(this.program, uniforms)
    const mesh = new PIXI.Mesh(geometry, shader, state)
    return mesh
  }
}
