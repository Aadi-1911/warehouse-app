import { useMemo, useRef } from 'react';
import { useECharts } from '../hooks/useECharts';

// A structurally faithful port of Apache ECharts' own "Doughnut Chart with Rounded Corner"
// example (pie-borderRadius.ts) — and, once `radius` is passed a single string instead of a
// two-value array, its sibling "Basic Pie Chart" example (pie-simple.ts) too, since the two
// official examples are otherwise identical: a bare `radius` value is the only thing that tells
// echarts "doughnut" from "full pie". Built as the Analytics page's own new, standalone
// component — deliberately NOT importing or reusing anything from EChartsDonut.jsx or
// Locations.jsx. Those exist to solve a different, already-settled problem (a fixed HTML overlay
// center label, plus emphasis.disabled to dodge a hover-flash bug — see EChartsDonut.jsx's own
// header). This component is the opposite approach on purpose (Analytics' decided "Option A"):
// real echarts emphasis, echarts' own built-in legend, center content revealed ONLY on hover.
//
// No per-slice `color` BY DEFAULT — the official reference doesn't set one either, letting
// echarts' own default categorical palette assign colors. That's the right default for a
// variable, possibly-growing set (Factories' revenue chart, or Parties later) with no fixed
// count to hand-pick colors for. `colors` (added when Locations.jsx briefly adopted this
// component with a per-metric KPI-accent palette, 2026-09-05) is the escape hatch for the
// opposite case: a caller with a genuinely fixed, small set of items that already has its own
// established color identity. One entry per `data` item, same order; entirely optional, and when
// omitted the series carries no itemStyle.color at all — same as before this prop existed, not a
// fallback default color computed some other way.
//
// CURRENTLY UNUSED BY ANY CALLER (same day, 2026-09-05) — Locations.jsx dropped its `colors` pair
// on Aadi's direct feedback after seeing custom colors mixed into this component in a real
// browser ("looked bad"); it now uses the same no-`colors` default palette Factories' revenue
// chart already did. Kept defined here anyway rather than deleted — it took real work to build,
// remains a reasonable general capability, and a future caller with a genuinely fixed small item
// set may still want it. Not dead code by accident; a deliberate keep of an unused-for-now prop.
//
// `radius` and `data` are the two props a caller MUST supply — everything else has a sensible
// default. `radius` is passed straight through to echarts, untouched (an array like
// ['40%', '70%'] for a doughnut, or a single string like '50%' for a full pie), rather than this
// component computing percentages from a size/strokeWidth pair the way EChartsDonut does — the
// official examples this is porting both just hardcode a radius value directly, and shaping the
// prop the same way is what makes this component reusable for pie-simple.ts's flavor later
// without inventing a second sizing scheme.
//
// centerFontSize (added 2026-09-05, default 40 — Factories' revenue chart's existing usage is
// completely unaffected by this default) exists because the hover-emphasis center label's size
// was originally hardcoded at 40px, tuned against Factories' single wide (~980px) card. Locations'
// donut cards sit in a 3-column grid (~322px each), and at that width the hardcoded 40px visibly
// clipped past both card edges — confirmed by a real rendered screenshot, not assumed. Exposed as
// a prop rather than a second hardcoded value so any future narrow-card caller can pick its own
// fitting size instead of this component silently guessing a container width.
export default function OfficialPieChart({
  data,
  radius,
  colors,
  seriesName = '',
  valueFormatter = (v) => String(v),
  height = 380,
  centerFontSize = 40,
  description,
}) {
  const containerRef = useRef(null);

  const option = useMemo(
    () => ({
      tooltip: { trigger: 'item' },
      legend: { top: '5%', left: 'center' },
      series: [
        {
          name: seriesName,
          type: 'pie',
          radius,
          avoidLabelOverlap: false,
          // borderColor: 'var(--card-bg)' (not the reference's literal '#fff') is the one
          // deliberate departure from the reference's exact values — same reasoning
          // EChartsDonut.jsx's own border gap already established: a hardcoded white wouldn't
          // match this app's card background in a future dark theme, and a CSS custom property
          // costs nothing here since echarts reads it at render time same as any other string.
          itemStyle: { borderRadius: 10, borderColor: 'var(--card-bg)', borderWidth: 2 },
          label: { show: false, position: 'center' },
          emphasis: {
            label: {
              show: true,
              fontSize: centerFontSize,
              fontWeight: 'bold',
              // Reveals THIS hovered slice's own name/value (Option A), never a fixed grand
              // total — which is exactly why this has to be a function formatter rather than an
              // echarts template string ('{b}: {c}'): only a function gets `valueFormatter`
              // applied to the real value instead of echarts' own default number stringification.
              formatter: (params) => `${params.name}: ${valueFormatter(params.value)}`,
            },
          },
          labelLine: { show: false },
          // `colors ? { ...d, itemStyle: { color: colors[i] } } : d` rather than always spreading
          // an itemStyle key — an explicit `itemStyle: { color: undefined }` on every datum (the
          // result of naively doing `color: colors?.[i]` unconditionally) is NOT the same no-op
          // as omitting itemStyle entirely; leaving it out completely is what keeps the no-`colors`
          // case byte-for-byte identical to this component's behavior before this prop existed.
          data: data.map((d, i) => (colors ? { name: d.name, value: d.value, itemStyle: { color: colors[i] } } : { name: d.name, value: d.value })),
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(data), JSON.stringify(radius), JSON.stringify(colors), seriesName, valueFormatter, centerFontSize]
  );

  useECharts(containerRef, option);

  const accessibleDescription = description ?? data.map((d) => `${d.name} ${d.value}`).join(', ');

  return <div ref={containerRef} style={{ width: '100%', height }} role="img" aria-label={accessibleDescription} />;
}
