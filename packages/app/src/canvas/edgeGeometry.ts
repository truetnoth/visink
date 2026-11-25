export interface EdgePoint {
  x: number;
  y: number;
}

/** Пересечение луча с приближением видимой границы вытянутого пина. */
export function pinBoundary(center: EdgePoint, toward: EdgePoint, radiusX = 7, radiusY = 10): EdgePoint {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (!dx && !dy) return { ...center };
  const scale = 1 / Math.sqrt((dx / radiusX) ** 2 + (dy / radiusY) ** 2);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

export function directEdgeBoundaries(source: EdgePoint, target: EdgePoint, targetRadiusY = 10) {
  return {
    source: pinBoundary(source, target),
    target: pinBoundary(target, source, 7, targetRadiusY),
  };
}

/** Для обратного маршрута направление на концах задают первый и последний сегменты. */
export function routedEdgeBoundaries(points: EdgePoint[], targetRadiusY = 10): EdgePoint[] {
  if (points.length < 2) return points;
  const out = points.map((point) => ({ ...point }));
  out[0] = pinBoundary(points[0], points[1]);
  out[out.length - 1] = pinBoundary(points.at(-1)!, points.at(-2)!, 7, targetRadiusY);
  return out;
}
