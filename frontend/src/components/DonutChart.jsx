import { useId } from 'react';

// Reusable hand-rolled SVG donut chart — no charting library (frontend/backend package.json both
// confirmed free of one before this component was written; see the 2026-09-02 donut-scoping
// investigation). Pure SVG, no arc-path (M/A) math: each slice is its own full <circle> stacked on
// the same center/radius, made to show only its own share of the ring via stroke-dasharray (a
// "dash gap" pattern the length of the circle's own circumference) plus a per-slice
// stroke-dashoffset that shifts where that dash starts, so consecutive slices sit end-to-end
// instead of overlapping. rotate(-90) on every slice moves the shared starting point from the
// SVG default (3 o'clock) to 12 o'clock, matching how a "clock face" pie/donut is normally read.
//
// Deliberately generic — no colour, label wording, or data shape here is specific to any one
// caller. `slices` is just { label, value, color }; whatever page renders this owns its own data
// fetch, its own colour picks (with their own collision check — see that caller's own comment),
// and its own center-label text. `description` is likewise caller-supplied (Locations.jsx passes
// its own currency-formatted string) since this component has no idea whether `value` is rupees,
// a count, or anything else — see the accessibility comment below for why it falls back to a raw
// label/value join, not a hardcoded unit, when a caller doesn't provide one.
export default function DonutChart({ slices, size = 160, strokeWidth = 24, centerLabel, centerSubLabel, description }) {
  const titleId = useId();
  const total = slices.reduce((sum, s) => sum + (s.value > 0 ? s.value : 0), 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const visibleSlices = slices.filter((s) => s.value > 0);
  // Gaps between slices only make sense once there are 2+ of them to separate — a single 100%
  // slice (today's real Gurgaon/Delhi data, Delhi at ₹0) must render as one complete, unbroken
  // ring. Applying a gap unconditionally would carve a fake seam into what is actually one whole
  // slice, wrongly implying a second boundary that isn't there.
  const gapLength = visibleSlices.length >= 2 ? strokeWidth * 0.35 : 0;

  // Running offset in circumference-units, not degrees — stroke-dasharray/-dashoffset are both
  // specified in the same units as the path length (pixels here), never angles. This MUST stay
  // based on each slice's true, ungapped length: it's what positions every later slice's start
  // point, and shrinking it by the gap here too would compound across slices, drifting each one
  // further off its real position instead of just trimming its own rendered end.
  let offsetSoFar = 0;
  const arcs = visibleSlices.map((slice) => {
    const fraction = total > 0 ? slice.value / total : 0;
    const trueDashLength = fraction * circumference;
    const arc = {
      key: slice.label,
      color: slice.color,
      // The gap is subtracted only from what's actually drawn, never from the cumulative offset
      // above — floored at 0 so a slice smaller than the gap itself still renders as a sliver
      // rather than a negative dash length.
      dashLength: Math.max(trueDashLength - gapLength, 0),
      // Negative offset shifts the dash pattern's start point FORWARD (clockwise) along the
      // circle by the combined length of every slice already placed — the same well-known
      // technique every stroke-based SVG pie/donut chart uses in place of manual arc paths.
      dashOffset: -offsetSoFar,
    };
    offsetSoFar += trueDashLength;
    return arc;
  });

  // Accessible description — checked first: this app's existing aria-label usage (Combobox,
  // ScreenHeader's back link, the dashboard PIN overlay's role="dialog", quantity steppers) is
  // exclusively on interactive controls, never on static visual/graphical content, so there's no
  // established in-app pattern to match for a chart. For an INLINE <svg> specifically (as opposed
  // to an <img src="chart.svg">), an aria-label on the wrapping <div> would be one option, but a
  // native SVG <title> is the more correct fit here: it's the SVG spec's own accessible-name
  // mechanism (the inline equivalent of an <img>'s alt text), works even if the SVG is ever
  // extracted/serialized on its own outside this component's wrapper div, and is what maps to
  // role="img"'s accessible name in the accepted authoring pattern for inline charts. Referenced
  // via aria-labelledby (not left implicit) since implicit <title>-as-name support for role="img"
  // SVGs is inconsistent across screen reader/browser pairings — aria-labelledby is the
  // unambiguous, spec-guaranteed way to point role="img" at it. useId() keeps the id collision-safe
  // if more than one DonutChart ever renders on the same page.
  //
  // Built from the full `slices` prop (not just the visible/nonzero ones) when no explicit
  // `description` is passed, so a real 0-value slice like Delhi is still named, not silently
  // dropped from what a screen reader hears — matching what a sighted viewer sees in the legend.
  const accessibleDescription = description ?? slices.map((s) => `${s.label} ${s.value}`).join(', ');

  return (
    <div className="donut-chart" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-labelledby={titleId}>
        <title id={titleId}>{accessibleDescription}</title>
        {/* Track — the full ring, underneath every slice, visible only where no slice covers it
            (e.g. if every value is 0, or fractions don't sum to the full circle by design). */}
        <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--card-border)" strokeWidth={strokeWidth} />
        {arcs.map((arc) => (
          <circle
            key={arc.key}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arc.dashLength} ${circumference - arc.dashLength}`}
            strokeDashoffset={arc.dashOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${center} ${center})`}
          />
        ))}
      </svg>
      {(centerLabel || centerSubLabel) && (
        <div className="donut-chart-center">
          {centerLabel && <span className="donut-chart-center-value">{centerLabel}</span>}
          {centerSubLabel && <span className="donut-chart-center-sub">{centerSubLabel}</span>}
        </div>
      )}
    </div>
  );
}
