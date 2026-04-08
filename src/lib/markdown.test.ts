import { describe, it, expect, beforeEach } from 'vitest';
import { renderMarkdown, stripMarkdown, setImageResolver } from './markdown';

describe('renderMarkdown', () => {
  // Reset image resolver to identity before each test
  beforeEach(() => {
    setImageResolver((f) => f);
  });

  it('renders bold and italic', async () => {
    const html = await renderMarkdown('**bold** and *italic*');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders inline KaTeX math', async () => {
    const html = await renderMarkdown('Energy: $E = mc^2$');
    expect(html).toContain('class="math math-inline"');
    expect(html).toContain('katex');
    expect(html).not.toContain('math-error');
    // KaTeX always emits an MathML <annotation> with the original LaTeX source for screen readers
    expect(html).toMatch(/E\s*=\s*mc\^?\{?2/);
  });

  it('renders block KaTeX math', async () => {
    const html = await renderMarkdown('$$\\int_0^1 x^2 dx$$');
    expect(html).toContain('class="math math-display"');
    expect(html).not.toContain('math-error');
    expect(html).toContain('katex');
  });

  it('does not parse currency as math', async () => {
    const html = await renderMarkdown('The book costs $5 and the pen costs $10.');
    expect(html).not.toContain('math-inline');
    expect(html).not.toContain('katex');
    expect(html).toContain('$5');
    expect(html).toContain('$10');
  });

  it('strips script tags via DOMPurify', async () => {
    const html = await renderMarkdown('<script>alert(1)</script>Hello');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Hello');
  });

  it('preserves ruby tags from the allowlist', async () => {
    const html = await renderMarkdown('<ruby>漢<rt>kan</rt></ruby>');
    expect(html).toContain('<ruby>');
    expect(html).toContain('<rt>');
  });

  it('strips iframe tags', async () => {
    const html = await renderMarkdown('<iframe src="http://evil"></iframe>');
    expect(html).not.toContain('<iframe');
  });

  it('strips javascript: URLs', async () => {
    const html = await renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  it('routes image filenames through the resolver', async () => {
    setImageResolver((f) => 'asset://test/' + f);
    const html = await renderMarkdown('![alt](abc.png)');
    expect(html).toContain('asset://test/abc.png');
    expect(html).toContain('alt="alt"');
  });

  it('renders fenced code blocks', async () => {
    const html = await renderMarkdown('```\nplain\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('plain');
  });
});

describe('stripMarkdown', () => {
  it('strips bold', () => {
    expect(stripMarkdown('**bold** text')).toBe('bold text');
  });

  it('strips inline code', () => {
    expect(stripMarkdown('`code` here')).toBe('code here');
  });

  it('replaces images with alt text', () => {
    expect(stripMarkdown('![my img](foo.png) caption')).toBe('my img caption');
  });

  it('replaces links with text', () => {
    expect(stripMarkdown('a [link](url) here')).toBe('a link here');
  });

  it('strips headings', () => {
    expect(stripMarkdown('# Heading\n\nbody')).toBe('Heading body');
  });

  it('strips bullets', () => {
    expect(stripMarkdown('- one\n- two')).toBe('one two');
  });

  it('truncates with ellipsis', () => {
    const result = stripMarkdown('x'.repeat(200), 50);
    expect(result.length).toBe(50);
    expect(result.endsWith('…')).toBe(true);
  });

  it('handles empty input', () => {
    expect(stripMarkdown('')).toBe('');
  });

  it('does not strip currency as math', () => {
    expect(stripMarkdown('costs $5 and $10')).toBe('costs $5 and $10');
  });
});
