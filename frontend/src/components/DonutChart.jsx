import { useId } from 'react';

// Reusable hand-rolled SVG donut chart — no charting library (frontend/backend package.json both
// confirmed free of one before this component was written; see the 2026-09-02 donut-scoping
// investigation).
//
// Each visible slice is its own <path>, an annular sector (a ring "wedge" between an inner and
// outer radius, spanning a start/end angle) with small rounded fillets at all four corners
// (outer-start, outer-end, inner-start, inner-end) — replacing an earlier stroke-circle +
// stroke-linecap="round" approach, which gave large bulbous semicircular ends instead of a crisp
// softened corner. Angles are measured in the standard math convention (0 = 3 o'clock, increasing
// clockwise in SVG's y-down coordinate system) with a fixed -90° start offset baked into
// SLICE_START_ANGLE so slice 0 begins at 12 o'clock, the same "clock face" reading the old
// rotate(-90) transform produced.
//
// Deliberately generic — no colour, label wording, or data shape here is specific to any one
// caller. `slices` is just { label, value, color }; whatever page renders this owns its own data
// fetch, its own colour picks (with their own collision check — see that caller's own comment),
// and its own center-label text. `description` is likewise caller-supplied (Locations.jsx passes
// its own currency-formatted string) since this component has no idea whether `value` is rupees,
// a count, or anything else — see the accessibility comment below for why it falls back to a raw
// label/value join, not a hardcoded unit, when a caller doesn't provide one.

const SLICE_START_ANGLE = -Math.PI / 2; // 12 o'clock
const FULL_TURN = 2 * Math.PI;

// Reference corner radius: proportionally SMALL relative to strokeWidth (~12%), not
// strokeWidth / 2 — the goal is a crisp softened corner, like a rounded rectangle bent into a
// ring, not a pill/capsule shape (which is what strokeWidth / 2 rounding on a stroked circle
// used to produce).
const CORNER_RADIUS_RATIO = 0.12;

function polarPoint(cx, cy, r, angle) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

// Builds the path data for one rounded-corner annular sector. Corners are approximated as small
// circular fillets tangent to the arc/radial edges they join: each fillet's tangent point on an
// arc is offset from the true (sharp) corner by an angle of (cornerRadius / thatArc'sRadius) —
// a small-angle approximation (arc length ≈ radius × angle) that's accurate enough for a
// deliberately small cornerRadius, and each fillet's tangent point on a radial edge is simply
// offset inward/outward by cornerRadius along that radius.
function roundedAnnularSectorPath(cx, cy, innerR, outerR, startAngle, endAngle, cornerRadius) {
  const span = endAngle - startAngle;

  // Guard against the small-slice edge case: if this slice's own angular span is too small for
  // the requested corner radius, the four fillets would overlap (or the arc's start would land
  // past its own end), corrupting the path — self-intersecting or inverting rather than just
  // "not very rounded". Clamp the EFFECTIVE corner radius down for this slice specifically,
  // proportional to its own span, rather than let that happen. A generous safety margin (0.9 of
  // the exact overlap threshold) keeps a hair of straight arc between the two fillets even at
  // the clamp boundary, instead of landing exactly on the seam.
  let radius = Math.min(cornerRadius, (outerR - innerR) / 2);
  let outerDelta = radius / outerR;
  let innerDelta = radius / innerR;
  const maxDelta = Math.max(outerDelta, innerDelta);
  if (maxDelta * 2 >= span) {
    const scale = (span / 2 / maxDelta) * 0.9;
    radius *= scale;
    outerDelta *= scale;
    innerDelta *= scale;
  }

  const outerStart = polarPoint(cx, cy, outerR, startAngle + outerDelta);
  const outerEnd = polarPoint(cx, cy, outerR, endAngle - outerDelta);
  const outerToInnerStart = polarPoint(cx, cy, outerR - radius, endAngle);
  const outerToInnerEnd = polarPoint(cx, cy, innerR + radius, endAngle);
  const innerEnd = polarPoint(cx, cy, innerR, endAngle - innerDelta);
  const innerStart = polarPoint(cx, cy, innerR, startAngle + innerDelta);
  const innerToOuterStart = polarPoint(cx, cy, innerR + radius, startAngle);
  const innerToOuterEnd = polarPoint(cx, cy, outerR - radius, startAngle);

  const largeArcOuter = endAngle - outerDelta - (startAngle + outerDelta) > Math.PI ? 1 : 0;
  const largeArcInner = endAngle - innerDelta - (startAngle + innerDelta) > Math.PI ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArcOuter} 1 ${outerEnd.x} ${outerEnd.y}`,
    `A ${radius} ${radius} 0 0 1 ${outerToInnerStart.x} ${outerToInnerStart.y}`,
    `L ${outerToInnerEnd.x} ${outerToInnerEnd.y}`,
    `A ${radius} ${radius} 0 0 1 ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerR} ${innerR} 0 ${largeArcInner} 0 ${innerStart.x} ${innerStart.y}`,
    `A ${radius} ${radius} 0 0 1 ${innerToOuterStart.x} ${innerToOuterStart.y}`,
    `L ${innerToOuterEnd.x} ${innerToOuterEnd.y}`,
    `A ${radius} ${radius} 0 0 1 ${outerStart.x} ${outerStart.y}`,
    'Z',
  ].join(' ');
}

// A full, uncut annulus — used when exactly one slice is visible (today's real Gurgaon/Delhi
// data, Delhi at ₹0), so it renders as one complete, unbroken ring rather than a wedge with a
// fake seam. An SVG arc command can't represent a full 360° sweep (its start and end point would
// coincide, which is degenerate), so each circle is drawn as two half-circle arcs instead — the
// standard way to express a complete circle as path data — and the two circles combine into a
// ring via evenodd fill.
function fullAnnulusPath(cx, cy, innerR, outerR) {
  const ring = (r) =>
    [
      `M ${cx - r} ${cy}`,
      `A ${r} ${r} 0 1 1 ${cx + r} ${cy}`,
      `A ${r} ${r} 0 1 1 ${cx - r} ${cy}`,
      'Z',
    ].join(' ');
  return `${ring(outerR)} ${ring(innerR)}`;
}

export default function DonutChart({ slices, size = 160, strokeWidth = 24, centerLabel, centerSubLabel, description }) {
  const titleId = useId();
  const total = slices.reduce((sum, s) => sum + (s.value > 0 ? s.value : 0), 0);
  const outerRadius = size / 2;
  const innerRadius = outerRadius - strokeWidth;
  const midRadius = (outerRadius + innerRadius) / 2;
  const center = size / 2;
  const cornerRadius = strokeWidth * CORNER_RADIUS_RATIO;

  const visibleSlices = slices.filter((s) => s.value > 0);
  // Gaps between slices only make sense once there are 2+ of them to separate — a single 100%
  // slice must render as one complete, unbroken ring (handled below via fullAnnulusPath).
  // Expressed as an angle now rather than a dash-length subtraction, but the same idea: a small
  // fixed visual gap, sized off strokeWidth, converted from a target arc-length-in-px to radians
  // via the standard arc-length/radius relationship.
  const gapAngle = visibleSlices.length >= 2 ? (strokeWidth * 0.35) / midRadius : 0;

  // Running angle in radians, not degrees-of-a-dash-pattern. This MUST stay based on each slice's
  // true, ungapped span: it's what positions every later slice's start angle, and shrinking it by
  // the gap here too would compound across slices, drifting each one further off its real
  // position instead of just trimming its own rendered end.
  let angleSoFar = SLICE_START_ANGLE;
  const wedges = [];
  if (visibleSlices.length === 1) {
    wedges.push({ key: visibleSlices[0].label, color: visibleSlices[0].color, full: true });
  } else {
    for (const slice of visibleSlices) {
      const fraction = total > 0 ? slice.value / total : 0;
      const trueSpan = fraction * FULL_TURN;
      const renderedSpan = Math.max(trueSpan - gapAngle, 0);
      if (renderedSpan > 0) {
        wedges.push({
          key: slice.label,
          color: slice.color,
          startAngle: angleSoFar,
          endAngle: angleSoFar + renderedSpan,
        });
      }
      angleSoFar += trueSpan;
    }
  }

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
        <circle
          cx={center}
          cy={center}
          r={midRadius}
          fill="none"
          stroke="var(--card-border)"
          strokeWidth={strokeWidth}
        />
        {wedges.map((wedge) =>
          wedge.full ? (
            <path key={wedge.key} d={fullAnnulusPath(center, center, innerRadius, outerRadius)} fill={wedge.color} fillRule="evenodd" />
          ) : (
            <path
              key={wedge.key}
              d={roundedAnnularSectorPath(center, center, innerRadius, outerRadius, wedge.startAngle, wedge.endAngle, cornerRadius)}
              fill={wedge.color}
            />
          )
        )}
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
