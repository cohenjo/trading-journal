import React from "react";
import type { RungData } from "./Ladder";

type RungProps = {
  rung: RungData;
  completion: number; // 0–1
  zoomScale?: number;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

const interpolateColor = (t: number): string => {
  // 0 → red (#ff0000), 0.5 → magenta (#ff00ff), 1 → blue (#0000ff)
  const tt = clamp(t, 0, 1);
  let r: number;
  let g: number;
  let b: number;

  if (tt <= 0.5) {
    // red -> magenta
    const localT = tt / 0.5;
    r = 255;
    g = 0;
    b = Math.round(255 * localT);
  } else {
    // magenta -> blue
    const localT = (tt - 0.5) / 0.5;
    r = Math.round(255 * (1 - localT));
    g = 0;
    b = 255;
  }

  return `rgb(${r}, ${g}, ${b})`;
};

export const Rung: React.FC<RungProps> = ({
  rung,
  completion,
  zoomScale = 1,
  onClick,
  onMouseEnter,
  onMouseLeave,
}) => {
  const percent = clamp(completion, 0, 1) * 100;
  const color = interpolateColor(completion);
  const roundedBucket = Math.round(percent / 10) * 10;
  const fillClass = `fill-${clamp(roundedBucket, 0, 100)}`;
  const colorClass =
    completion < 0.33 ? "color-low" : completion < 0.66 ? "color-mid" : "color-high";
  const zoomClass =
    zoomScale > 1.2 ? "rung-row-zoom-in" : zoomScale < 0.9 ? "rung-row-zoom-out" : "";

  return (
    <div
      className={`rung-row ${zoomClass} ${fillClass} ${colorClass}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="rung-year">{rung.year}</div>
      <div className="rung-bar-outer">
        <div className="rung-bar-inner" />
      </div>
      <div className="rung-percent-label">{Math.round(percent)}%</div>
    </div>
  );
};
