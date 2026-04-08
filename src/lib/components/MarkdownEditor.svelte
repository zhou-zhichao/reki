<script lang="ts">
  import Markdown from './Markdown.svelte';
  import { importBlob } from '../media';

  interface Props {
    value: string;
    label: string;
    rows?: number;
  }

  let { value = $bindable(''), label, rows = 5 }: Props = $props();

  type Tab = 'edit' | 'preview';
  let tab = $state<Tab>('edit');
  let textarea: HTMLTextAreaElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let error = $state<string | null>(null);
  let dragging = $state(false);

  function insertAtCursor(text: string) {
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    value = value.slice(0, start) + text + value.slice(end);
    // Restore cursor after the inserted text on next tick
    queueMicrotask(() => {
      if (!textarea) return;
      const pos = start + text.length;
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
    });
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      error = `Not an image: ${file.type || 'unknown type'}`;
      return;
    }
    error = null;
    try {
      const filename = await importBlob(file);
      insertAtCursor(`![image](${filename})`);
    } catch (e) {
      error = `Image upload failed: ${e}`;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    for (const f of files) handleFile(f);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    dragging = true;
  }

  function onDragLeave() {
    dragging = false;
  }

  function onPaste(e: ClipboardEvent) {
    const items = Array.from(e.clipboardData?.items ?? []);
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleFile(file);
          return;
        }
      }
    }
  }

  function onPickFile() {
    fileInput?.click();
  }

  function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    for (const f of files) handleFile(f);
    input.value = '';
  }
</script>

<div class="md-editor">
  <div class="md-toolbar">
    <div class="md-tabs">
      <button
        class="tab"
        class:active={tab === 'edit'}
        onclick={() => tab = 'edit'}
      >Edit</button>
      <button
        class="tab"
        class:active={tab === 'preview'}
        onclick={() => tab = 'preview'}
      >Preview</button>
    </div>
    <button class="img-btn" onclick={onPickFile} title="Insert image">+ Image</button>
    <input
      type="file"
      accept="image/*"
      bind:this={fileInput}
      onchange={onFileChange}
      style="display: none"
    />
  </div>

  {#if tab === 'edit'}
    <textarea
      bind:this={textarea}
      bind:value
      class="md-textarea"
      class:dragging
      aria-label={label}
      {rows}
      ondrop={onDrop}
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      onpaste={onPaste}
    ></textarea>
  {:else}
    <div class="md-preview">
      {#if value.trim()}
        <Markdown src={value} />
      {:else}
        <span class="md-preview-empty">(empty)</span>
      {/if}
    </div>
  {/if}

  {#if error}
    <div class="md-error">{error}</div>
  {/if}
</div>

<style>
  .md-editor {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .md-toolbar {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  .md-tabs {
    display: flex;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    overflow: hidden;
    flex: 1;
  }

  .tab {
    flex: 1;
    padding: var(--sp-xs) var(--sp-sm);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-secondary);
    transition: all var(--dur-micro) var(--ease);
    border-right: 1px solid var(--border);
  }

  .tab:last-child { border-right: none; }

  .tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tab.active {
    background: var(--accent-bg);
    color: var(--accent);
  }

  .img-btn {
    padding: var(--sp-xs) var(--sp-sm);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    transition: all var(--dur-micro) var(--ease);
    white-space: nowrap;
  }

  .img-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .md-textarea {
    width: 100%;
    resize: vertical;
    font-family: 'Geist Mono', monospace;
    font-size: var(--text-sm);
    line-height: 1.5;
    transition: border-color var(--dur-micro) var(--ease);
  }

  .md-textarea.dragging {
    border-color: var(--accent);
    background: var(--accent-bg);
  }

  .md-preview {
    min-height: 60px;
    padding: var(--sp-sm);
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    font-size: var(--text-sm);
  }

  .md-preview-empty {
    color: var(--text-muted);
    font-style: italic;
  }

  .md-error {
    font-size: var(--text-xs);
    color: var(--c-again);
    padding: var(--sp-xs) var(--sp-sm);
    background: color-mix(in srgb, var(--c-again) 10%, transparent);
    border-radius: var(--r-sm);
  }
</style>
