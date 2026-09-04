import { useMemo, useRef } from 'react';
import { useECharts } from '../hooks/useECharts';

// This app's only donut-rendering component, built on echarts (its first external charting
// library). Introduced 2026-09-03 as a proof of concept for just the Stock value donut on
// Locations.jsx, with Revenue/Profit deliberately left on a hand-rolled DonutChart.jsx for direct
// side-by-side comparison. That comparison is done: as of 2026-09-04 (81b1f7a) all three
// Locations donuts (Stock value, Revenue, Profit) render through this component, and
// DonutChart.jsx was deleted since nothing else in the app used it.
//
// Prop shape ({ slices, size, strokeWidth, centerLabel, centerSubLabel, description }) matches
// what DonutChart.jsx used to accept, by design — the point was for each caller's migration to be
// a one-line swap, not a data-shape rewrite, and that's exactly how it played out.
//
// Center label is a real HTML overlay (reusing the shared .donut-chart-center CSS), not echarts'
// internal text/graphic API — getting font-family/colour to match this app's tokens exactly
// through echarts' own text-styling options would mean re-deriving CSS custom property values in
// JS; a plain absolutely-positioned div over the chart gets pixel-identical typography for free,
// and echarts has no idea it's there (pointer-events: none).
export default function EChartsDonut({
  slices,
  size = 160,
  strokeWidth = 24,
  centerLabel,
  centerSubLabel,
  description,
  tooltipValueFormatter = (v) => String(v),
}) {
  const containerRef = useRef(null);

  // Radius is expressed to echarts as percentages of the container's own box (a bare number in
  // echarts' radius option means "% of the container", not px — see useECharts.js's own comment
  // for why the container itself is sized to exactly `size`x`size` px). 100% outer radius fills
  // the box exactly like DonutChart's outerRadius = size / 2; inner radius is scaled down from
  // that by the same ratio strokeWidth/size that the hand-rolled version computes directly in px.
  const outerRadiusPercent = 100;
  const innerRadiusPercent = Math.max(0, ((size / 2 - strokeWidth) / (size / 2)) * 100);

  // Same non-positive-value exclusion DonutChart applies (a location at ₹0 gets no ring slice) —
  // done here rather than relied on from echarts itself: a zero-value pie datum still reserves a
  // legend/tooltip entry and can render as a hairline sliver depending on version, neither of
  // which matches the established "not shown at all" behaviour every other donut on this page
  // already has.
  const visibleSlices = slices.filter((s) => s.value > 0);

  const option = useMemo(
    () => ({
      tooltip: {
        trigger: 'item',
        formatter: (params) => `${params.name}: ${tooltipValueFormatter(params.value)}`,
      },
      series: [
        // Track ring, drawn first (so the real data series layers on top of it) — matches
        // DonutChart's own always-present grey <circle>, visible only where no real slice covers
        // it (e.g. if every location's value is <= 0 today).
        {
          type: 'pie',
          radius: [`${innerRadiusPercent}%`, `${outerRadiusPercent}%`],
          silent: true,
          label: { show: false },
          tooltip: { show: false },
          data: [{ value: 1, itemStyle: { color: 'var(--card-border)' } }],
        },
        {
          type: 'pie',
          radius: [`${innerRadiusPercent}%`, `${outerRadiusPercent}%`],
          startAngle: 90, // echarts measures from 3 o'clock counter-clockwise; 90 puts slice 0 at 12 o'clock, matching DonutChart's own SLICE_START_ANGLE
          clockwise: true,
          avoidLabelOverlap: false,
          label: { show: false },
          labelLine: { show: false },
          // outerRadiusPercent is a full 100% of the container, no headroom — echarts' default
          // hover "emphasis" state scales the hovered slice up, which at 100% has nowhere to grow
          // but the container edge, clipping/redrawing on every small cursor move (the confirmed
          // cause of the hover flashing; the temporary logging in useECharts.js ruled out the hook
          // itself first). Tooltip stays working — only the scale animation is disabled.
          emphasis: { scale: false },
          // Rounded corners on every wedge (outer AND inner, all four corners) — the crisp,
          // not-bulbous style this whole component exists to validate. borderWidth/borderColor
          // (set to the card background) is the standard echarts technique for a visible gap
          // between adjacent slices, the closest built-in equivalent to DonutChart's own
          // angle-based gap.
          itemStyle: {
            borderRadius: strokeWidth * 0.12,
            borderColor: 'var(--card-bg)',
            borderWidth: visibleSlices.length >= 2 ? 3 : 0,
          },
          data: visibleSlices.map((s) => ({
            name: s.label,
            value: s.value,
            itemStyle: { color: s.color },
          })),
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(visibleSlices), innerRadiusPercent, outerRadiusPercent, strokeWidth]
  );

  useECharts(containerRef, option);

  const accessibleDescription = description ?? slices.map((s) => `${s.label} ${s.value}`).join(', ');

  return (
    <div className="donut-chart" style={{ width: size, height: size }}>
      <div ref={containerRef} style={{ width: size, height: size }} role="img" aria-label={accessibleDescription} />
      {(centerLabel || centerSubLabel) && (
        <div className="donut-chart-center">
          {centerLabel && <span className="donut-chart-center-value">{centerLabel}</span>}
          {centerSubLabel && <span className="donut-chart-center-sub">{centerSubLabel}</span>}
        </div>
      )}
    </div>
  );
}
