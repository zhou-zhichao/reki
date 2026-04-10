<script lang="ts">
  interface Props {
    label: string;
    value: string;
  }
  let { label, value }: Props = $props();
</script>

<div class="stat-card">
  <div class="stat-value">{value}</div>
  <div class="stat-label">{label}</div>
</div>

<style>
  .stat-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-xs);
    padding: var(--sp-md) var(--sp-lg);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    flex: 1;
    min-width: 100px;
  }

  .stat-value {
    font-family: 'Satoshi', sans-serif;
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
  }

  .stat-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 500;
  }
</style>
