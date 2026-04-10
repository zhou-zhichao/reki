import { describe, it, expect } from 'vitest';
import { parseClozes, extractClozeNumbers, renderClozeFront, renderClozeBack, hasCloze } from './cloze';

describe('parseClozes', () => {
  it('parses a single cloze without hint', () => {
    const result = parseClozes('The capital is {{c1::Paris}}');
    expect(result).toEqual([
      { num: 1, answer: 'Paris', hint: undefined, start: 15, end: 28 },
    ]);
  });

  it('parses a cloze with hint', () => {
    const result = parseClozes('Capital is {{c1::Paris::European city}}');
    expect(result).toEqual([
      { num: 1, answer: 'Paris', hint: 'European city', start: 11, end: 39 },
    ]);
  });

  it('parses multiple clozes', () => {
    const result = parseClozes('{{c1::Paris}} is in {{c2::France}}');
    expect(result).toHaveLength(2);
    expect(result[0].num).toBe(1);
    expect(result[1].num).toBe(2);
  });

  it('returns empty array for no clozes', () => {
    expect(parseClozes('No clozes here')).toEqual([]);
  });

  it('handles empty answer', () => {
    const result = parseClozes('{{c1::}}');
    expect(result[0].answer).toBe('');
  });
});

describe('extractClozeNumbers', () => {
  it('returns sorted unique numbers', () => {
    expect(extractClozeNumbers('{{c3::a}} {{c1::b}} {{c3::c}}')).toEqual([1, 3]);
  });

  it('returns empty for no clozes', () => {
    expect(extractClozeNumbers('plain text')).toEqual([]);
  });
});

describe('hasCloze', () => {
  it('returns true for text with cloze', () => {
    expect(hasCloze('{{c1::test}}')).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(hasCloze('no cloze')).toBe(false);
  });
});

describe('renderClozeFront', () => {
  it('blanks the active cloze, shows others', () => {
    const text = '{{c1::Paris}} is in {{c2::France}}';
    const result = renderClozeFront(text, 1);
    expect(result).toContain('<span class="cloze-blank">[...]</span>');
    expect(result).toContain('France');
    expect(result).not.toContain('{{c2::');
  });

  it('uses hint when provided', () => {
    const text = '{{c1::Paris::a city}}';
    const result = renderClozeFront(text, 1);
    expect(result).toContain('<span class="cloze-blank">[a city]</span>');
  });

  it('blanks all occurrences of same cloze number', () => {
    const text = '{{c1::A}} and {{c1::B}}';
    const result = renderClozeFront(text, 1);
    const blanks = result.match(/cloze-blank/g);
    expect(blanks).toHaveLength(2);
  });
});

describe('renderClozeBack', () => {
  it('highlights the active cloze, shows others plain', () => {
    const text = '{{c1::Paris}} is in {{c2::France}}';
    const result = renderClozeBack(text, 1);
    expect(result).toContain('<span class="cloze-answer">Paris</span>');
    expect(result).toContain('France');
    expect(result).not.toContain('{{');
  });
});

import { renderMarkdownCloze } from './markdown';

describe('renderMarkdownCloze', () => {
  it('renders cloze front with markdown', async () => {
    const html = await renderMarkdownCloze('**Bold** {{c1::Paris}}', 1, false);
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('cloze-blank');
  });

  it('renders cloze back with highlighted answer', async () => {
    const html = await renderMarkdownCloze('{{c1::Paris}}', 1, true);
    expect(html).toContain('cloze-answer');
    expect(html).toContain('Paris');
  });
});
