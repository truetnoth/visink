export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

let readViewport: (() => CanvasViewport) | null = null;

export function registerCanvasViewport(reader: () => CanvasViewport) {
  readViewport = reader;
  return () => {
    if (readViewport === reader) readViewport = null;
  };
}

export function currentCanvasViewport() {
  return readViewport?.();
}
