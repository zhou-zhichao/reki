<script lang="ts">
  interface Segment {
    label: string;
    value: number;
    color: string;
  }

  interface Props {
    segments: Segment[];
    centerLabel?: string;
    size?: number;
  }

  let { segments, centerLabel, size = 180 }: Props = $props();

  const total = $derived(segments.reduce((s, seg) => s + seg.value, 0));
  const radius = size / 2 - 10;
  const strokeWidth = 24;
  const circumference = 2 * Math.PI * radius;

  const arcs = $derived.by(() => {
    let offset = 0;
    return segments.map(seg => {
      const pct = total > 0 ? seg.value / total : 0;
      const dashLen = pct * circumference;
      const dashOffset = -offset;
      offset += dashLen;
      return { ...seg, dashLen, dashOffset, pct };
    });
  });
</script>

<div class="donut-wrap">
  <svg viewBox="0 0 {size} {size}" width={size} height={size}>
    {#each arcs as arc}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={arc.color}
        stroke-width={strokeWidth}
        stroke-dasharray="{arc.dashLen} {circumference - arc.dashLen}"
        stroke-dashoffset={arc.dashOffset}
        transform="rotate(-90 {size / 2} {size / 2})"
      >
        <title>{arc.label}: {arc.value} ({(arc.pct * 100).toFixed(1)}%)</title>
      </circle>
    {/each}

    {#if centerLabel}
      <text x={size / 2} y={size / 2} text-anchor="middle" dominant-baseline="central" class="center-text">
        {centerLabel}
      </text>
    {/if}
  </svg>

  <div class="donut-legend">
    {#each segments as seg}
      {#if seg.value > 0}
        <div class="legend-item">
          <span class="legend-dot" style="background: {seg.color}"></span>
          <span class="legend-label">{seg.label}</span>
          <span class="legend-value">{seg.value}</span>
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .donut-wrap {
    display: flex;
    align-items: center;
    gap: var(--sp-lg);
  }

  .center-text {
    font-family: 'Satoshi', sans-serif;
    font-size: 24px;
    font-weight: 700;
    fill: var(--text-primary);
  }

  .donut-legend {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    font-size: var(--text-sm);
  }

  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .legend-label {
    color: var(--text-secondary);
    flex: 1;
  }

  .legend-value {
    color: var(--text-primary);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
</style>
