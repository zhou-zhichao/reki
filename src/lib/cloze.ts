/**
 * Cloze deletion parser and renderer.
 *
 * Syntax:  {{c<N>::<answer>}}  or  {{c<N>::<answer>::<hint>}}
 * N is a positive integer. Answer and hint can contain any text except `}}`.
 */

export interface Cloze {
  num: number;
  answer: string;
  hint: undefined | string;
  start: number;
  end: number;
}

const CLOZE_PATTERN = /\{\{c(\d+)::([^}]*?)(?:::([^}]*?))?\}\}/;
const CLOZE_RE_G = new RegExp(CLOZE_PATTERN.source, 'g');

export function parseClozes(text: string): Cloze[] {
  const results: Cloze[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(CLOZE_PATTERN.source, 'g');
  while ((m = re.exec(text)) !== null) {
    results.push({
      num: parseInt(m[1], 10),
      answer: m[2],
      hint: m[3] !== undefined ? m[3] : undefined,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return results;
}

export function extractClozeNumbers(text: string): number[] {
  const nums = new Set<number>();
  for (const c of parseClozes(text)) nums.add(c.num);
  return [...nums].sort((a, b) => a - b);
}

export function hasCloze(text: string): boolean {
  return CLOZE_PATTERN.test(text);
}

export function renderClozeFront(text: string, ordinal: number): string {
  return text.replace(
    new RegExp(CLOZE_PATTERN.source, 'g'),
    (_match, num: string, answer: string, hint: string | undefined) => {
      if (parseInt(num, 10) === ordinal) {
        const label = hint !== undefined ? hint : '...';
        return `<span class="cloze-blank">[${label}]</span>`;
      }
      return answer;
    },
  );
}

export function renderClozeBack(text: string, ordinal: number): string {
  return text.replace(
    new RegExp(CLOZE_PATTERN.source, 'g'),
    (_match, num: string, answer: string) => {
      if (parseInt(num, 10) === ordinal) {
        return `<span class="cloze-answer">${answer}</span>`;
      }
      return answer;
    },
  );
}
