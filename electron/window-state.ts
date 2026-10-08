import fs from "node:fs";
import type { Rectangle } from "electron";
import type { Logger } from "../src/server/logger.ts";

/** Where the window was when the app last closed it, which the next start restores. */
export interface WindowState {
  bounds: Rectangle;
  maximized: boolean;
}

/** How much of the window's top edge a display must show for the window to be grabbed there. */
const GRAB_AREA = { width: 120, height: 32 };

/** The saved state, or null when there is none or it is not one the app wrote. */
export function readWindowState(file: string): WindowState | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    return parseWindowState(JSON.parse(text));
  } catch {
    return null;
  }
}

export function saveWindowState(file: string, state: WindowState, logger: Logger): void {
  try {
    fs.writeFileSync(file, `${JSON.stringify(state)}\n`);
  } catch (error) {
    logger.warn(`could not save the window's position to ${file}`, error);
  }
}

export function parseWindowState(value: unknown): WindowState | null {
  if (typeof value !== "object" || value === null) return null;
  const { bounds, maximized } = value as Record<string, unknown>;
  if (typeof maximized !== "boolean" || !isRectangle(bounds)) return null;
  return { bounds, maximized };
}

/**
 * The saved bounds when a display still shows enough of the window's top edge to drag it, at
 * least the minimum size; null when the window would open out of reach, such as on a display
 * that is no longer connected.
 */
export function reachableBounds(
  saved: Rectangle,
  workAreas: Rectangle[],
  minimum: { width: number; height: number },
): Rectangle | null {
  const bounds = {
    ...saved,
    width: Math.max(saved.width, minimum.width),
    height: Math.max(saved.height, minimum.height),
  };
  const topEdge = { x: bounds.x, y: bounds.y, width: bounds.width, height: GRAB_AREA.height };
  const reachable = workAreas.some((area) => {
    const overlap = intersection(topEdge, area);
    return overlap.width >= GRAB_AREA.width && overlap.height >= GRAB_AREA.height;
  });
  return reachable ? bounds : null;
}

function intersection(left: Rectangle, right: Rectangle): { width: number; height: number } {
  const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

function isRectangle(value: unknown): value is Rectangle {
  if (typeof value !== "object" || value === null) return false;
  const rectangle = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((key) => Number.isFinite(rectangle[key]));
}
