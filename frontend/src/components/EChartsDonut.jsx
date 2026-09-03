import { useMemo, useRef } from 'react';
import { useECharts } from '../hooks/useECharts';

// Proof-of-concept echarts version of DonutChart.jsx (2026-09-03) — this app's FIRST use of an
// external charting library. Deliberately validates just one thing before three more charts and a
// new layout get built on top of it: does a real echarts pie, styled to match this app's own
// tokens, actually look right here. Locations.jsx wires this up for the Stock value donut only;
// Revenue/Profit stay on the hand-rolled DonutChart for a direct side-by-side comparison.
//
// Same prop shape as DonutChart on purpose ({ slices, size, strokeWidth, centerLabel,
// centerSubLabel, description }) — swapping which component a caller uses is meant to be a
// one-line change, not a data-shape rewrite, if/when the rest of the donuts migrate later.
//
// Center label is a real HTML overlay (reusing DonutChart's own .donut-chart-center CSS), not
// echarts' internal text/graphic API — getting font-family/colour to match this app's tokens
// exactly through echarts' own text-styling options would mean re-deriving CSS custom property
// values in JS; a plain absolutely-positioned div over the chart gets pixel-identical typography
// for free, and echarts has no idea it's there (pointer-events: none, same as the old component).
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
