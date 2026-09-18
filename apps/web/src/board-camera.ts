export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type BoardCamera = { center: Point; zoom: number };
export const MIN_BOARD_ZOOM = 1;
export const MAX_BOARD_ZOOM = 4;
/** Presentation-only ocean margin, allowing edge/coastal spaces to center. */
export const BOARD_EDGE_PADDING = 500;

export function cameraScale(camera: BoardCamera, viewport: Size, world: Size): number {
  return Math.max(viewport.width / world.width, viewport.height / world.height) * camera.zoom;
}

export function clampCamera(camera: BoardCamera, viewport: Size, world: Size): BoardCamera {
  const zoom = Math.max(MIN_BOARD_ZOOM, Math.min(MAX_BOARD_ZOOM, camera.zoom));
  const scale = cameraScale({ ...camera, zoom }, viewport, world);
  const halfWidth = Math.min(world.width / 2, viewport.width / scale / 2);
  const halfHeight = Math.min(world.height / 2, viewport.height / scale / 2);
  return { zoom, center: {
    x: Math.max(halfWidth - BOARD_EDGE_PADDING, Math.min(world.width - halfWidth + BOARD_EDGE_PADDING, camera.center.x)),
    y: Math.max(halfHeight - BOARD_EDGE_PADDING, Math.min(world.height - halfHeight + BOARD_EDGE_PADDING, camera.center.y)),
  } };
}

export function resetCamera(viewport: Size, world: Size): BoardCamera {
  return clampCamera({ zoom: 1, center: { x: world.width / 2, y: world.height / 2 } }, viewport, world);
}

export function screenToWorld(point: Point, camera: BoardCamera, viewport: Size, world: Size): Point {
  const scale = cameraScale(camera, viewport, world);
  return { x: camera.center.x + (point.x - viewport.width / 2) / scale,
    y: camera.center.y + (point.y - viewport.height / 2) / scale };
}

export function zoomCamera(camera: BoardCamera, zoom: number, anchor: Point, viewport: Size, world: Size): BoardCamera {
  const before = screenToWorld(anchor, camera, viewport, world);
  const next = clampCamera({ ...camera, zoom }, viewport, world);
  const after = screenToWorld(anchor, next, viewport, world);
  return clampCamera({ ...next, center: { x: next.center.x + before.x - after.x, y: next.center.y + before.y - after.y } }, viewport, world);
}

export function panCamera(camera: BoardCamera, delta: Point, viewport: Size, world: Size): BoardCamera {
  const scale = cameraScale(camera, viewport, world);
  return clampCamera({ ...camera, center: { x: camera.center.x - delta.x / scale, y: camera.center.y - delta.y / scale } }, viewport, world);
}

export function cameraView(camera: BoardCamera, viewport: Size, world: Size) {
  const scale = cameraScale(camera, viewport, world);
  const width = viewport.width / scale;
  const height = viewport.height / scale;
  return { x: camera.center.x - width / 2, y: camera.center.y - height / 2, width, height };
}
