import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { PieChart } from 'echarts/charts';
import { TooltipComponent, LegendComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

// echarts' own tree-shaking entry point (echarts/core) ships NO chart type, component, or
// renderer by default — each one is a separate module you opt into via echarts.use([...]), so a
// bundle only pays for what it actually imports. This app currently only needs a pie chart (used
// in doughnut form, via the series' own radius option) with a tooltip and legend, rendered as SVG
// — not Canvas — since every other chart already in this codebase (DonutChart's hand-rolled
// annular-sector <path>s) is SVG, and these are small, low-frequency-update charts where SVG's
// crisper edges at this size matter more than Canvas's raw pixel-pushing speed.
//
// echarts.use() is a global, one-time registration (idempotent — calling it again with the same
// modules is a no-op), so it happens once at module load here rather than inside the hook body,
// which would otherwise attempt it on every mount.
echarts.use([PieChart, TooltipComponent, LegendComponent, SVGRenderer]);

// Thin wrapper around a raw echarts instance — deliberately not a React component (a chart
// library's DOM node is imperative, echarts owns and mutates it directly; wrapping that in
// React's own reconciliation would fight echarts rather than help it, which is exactly why
// react wrapper packages like echarts-for-react exist and were deliberately NOT installed here,
// see this task). `containerRef` is a caller-owned ref to the DOM node echarts should mount into;
// `option` is a plain echarts option object, recomputed by the caller (e.g. via useMemo) whenever
// the underlying data changes — this hook just re-applies whatever option it's given.
//
// Handles the three things a caller would otherwise have to reimplement by hand: creating the
// instance once and disposing it on unmount (an echarts instance is real WebGL/SVG/Canvas state,
// not a React node — leaving it un-disposed leaks), re-applying `option` whenever it changes
// (via setOption, not re-init — re-init would destroy and rebuild the whole chart, including its
// transition/animation state, on every data refresh), and resizing when the container's own size
// changes. The hand-rolled DonutChart never had to think about resize at all (an inline <svg>
// with width/height attributes just IS the size React gives it, no separate library-owned canvas
// to keep in sync) — an echarts instance owns its own internal canvas/SVG sized at init time, so
// without an explicit resize call it stays whatever size the container was on first paint even if
// the container (e.g. a browser window resize, or this page's own responsive layout) changes size
// later.
export function useECharts(containerRef, option) {
  const chartRef = useRef(null);

  // Init + dispose only — deliberately NOT re-run when `option` changes (see the effect below for
  // that). Re-creating the echarts instance on every option change would be wasteful (a fresh
  // instance re-parses the whole option from scratch, no diffing) and would restart every
  // transition animation instead of letting echarts animate FROM the previous state TO the new
  // one, which is what setOption on an existing instance does for you.
  useEffect(() => {
    console.log('[useECharts] chart init');
    if (!containerRef.current) return undefined;
    const chart = echarts.init(containerRef.current, undefined, { renderer: 'svg' });
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      console.log('[useECharts] ResizeObserver fired, calling resize()');
      chart.resize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      console.log('[useECharts] chart disposed');
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    console.log('[useECharts] setOption called');
    if (!chartRef.current) return;
    // notMerge: false (the default) — each call merges into the existing option rather than
    // replacing it wholesale, which is what lets echarts animate a series' values changing
    // instead of the chart flashing to a blank state and back.
    chartRef.current.setOption(option);
  }, [option]);
}
