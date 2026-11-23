// pbf and vector-tile ship no types. Only what heatmapTileLayer.ts uses.
declare module 'pbf' {
  export default class Pbf {
    constructor(buf?: Uint8Array);
  }
}
declare module 'vector-tile' {
  import Pbf from 'pbf';
  interface VTFeature {
    properties: Record<string, unknown>;
    loadGeometry(): { x: number; y: number }[][];
  }
  interface VTLayer {
    length: number;
    extent: number;
    feature(i: number): VTFeature;
  }
  export class VectorTile {
    constructor(pbf: Pbf);
    layers: Record<string, VTLayer>;
  }
}
