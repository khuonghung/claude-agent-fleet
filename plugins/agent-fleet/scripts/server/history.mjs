// The history sampler: one point a minute of the fleet's vital signs, kept on disk so a restart
// keeps the charts. Small on purpose: counts only, no ticket or transcript content.
import fs from "node:fs";
import path from "node:path";

const MAX = 24 * 60;

export function createHistory(file) {
  let points = [];
  try {
    points = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    points = [];
  }
  const save = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(points));
    } catch {
      // A read-only disk only costs the history across restarts.
    }
  };

  /** Adds a point (replacing one in the same minute) and returns the series. */
  function sample(point) {
    const minute = point.at.slice(0, 16);
    if (points.length && points[points.length - 1].at.slice(0, 16) === minute) points[points.length - 1] = point;
    else points.push(point);
    if (points.length > MAX) points.splice(0, points.length - MAX);
    save();
    return points;
  }

  return { sample, points: () => points };
}
