<script lang="ts">
  interface BarSegment {
    value: number;
    color: string;
  }

  interface Bar {
    label: string;
    segments: BarSegment[];
  }

  interface Props {
    bars: Bar[];
    height?: number;
    stacked?: boolean;
  }

  let { bars, height = 200, stacked = false }: Props = $props();

  const maxValue = $derived(
    Math.max(1, ...bars.map(b =>
      stacked ? b.segments.reduce((s, seg) => s + seg.value, 0) : Math.max(...b.segments.map(seg => seg.value))
    ))
  );

  const barWidth = $derived(Math.max(2, Math.min(20, Math.floor(500 / Math.max(bars.length, 1)) - 2)));
  const chartWidth = $derived(bars.length * (barWidth + 2) + 40);
</script>

<div class="bar-chart-wrap">
  <svg
    viewBox="0 0 {chartWidth} {height + 30}"
    class="bar-chart"
    preserveAspectRatio="xMinYMin meet"
  >
    {#each bars as bar, i}
      {@const total = stacked ? bar.segments.reduce((s, seg) => s + seg.value, 0) : 0}
      {@const x = 30 + i * (barWidth + 2)}
      {#if stacked}
        {@const barH = (total / maxValue) * height}
        {#each bar.segments as seg, si}
          {@const segH = total > 0 ? (seg.value / total) * barH : 0}
          {@const prevH = bar.segments.slice(0, si).reduce((s, ps) => s + (total > 0 ? (ps.value / total) * barH : 0), 0)}
          <rect
            {x}
            y={height - prevH - segH}
            width={barWidth}
            height={Math.max(0, segH)}
            fill={seg.color}
            rx="1"
          >
            <title>{seg.value}</title>
          </rect>
        {/each}
      {:else}
        {#each bar.segments as seg}
          {@const barH = (seg.value / maxValue) * height}
          <rect
            {x}
            y={height - barH}
            width={barWidth}
            height={Math.max(0, barH)}
            fill={seg.color}
            rx="1"
          >
            <title>{bar.label}: {seg.value}</title>
          </rect>
        {/each}
      {/if}

      {#if i % Math.max(1, Math.floor(bars.length / 6)) === 0}
        <text
          x={x + barWidth / 2}
          y={height + 16}
          text-anchor="middle"
          class="axis-label"
        >{bar.label}</text>
      {/if}
    {/each}

    <line x1="28" y1="0" x2="28" y2={height} stroke="var(--border)" stroke-width="1" />
    <line x1="28" y1={height} x2={chartWidth} y2={height} stroke="var(--border)" stroke-width="1" />

    <text x="24" y="10" text-anchor="end" class="axis-label">{maxValue}</text>
    <text x="24" y={height} text-anchor="end" class="axis-label">0</text>
  </svg>
</div>

<style>
  .bar-chart-wrap {
    width: 100%;
    overflow-x: auto;
  }

  .bar-chart {
    width: 100%;
    max-height: 240px;
  }

  .axis-label {
    font-size: 9px;
    fill: var(--text-muted);
    font-family: 'Geist Mono', monospace;
  }
</style>
