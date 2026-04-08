/**
 * Anki-compatible browse query language for Reki.
 *
 * Modeled after Anki's `rslib/src/search/parser.rs`. Implements the subset
 * of features that fit Reki's data model.
 *
 * SUPPORTED
 * ──────────
 * Boolean:
 *   a b              implicit AND
 *   a AND b          explicit AND (case-insensitive)
 *   a OR b           OR
 *   -term            NOT
 *   (a OR b) c       grouping
 *   "exact phrase"   quoted (spaces literal, \" and \\ escapes)
 *
 * Wildcards:
 *   *                zero or more characters
 *   _                exactly one character
 *   \*  \_           literal star / underscore
 *
 * Field searches (use exact match unless wildcards present):
 *   front:hello      front field contains/matches
 *   back:hello       back field
 *   tag:vocab        has tag (matches subtags via "vocab::*")
 *   tag:none         has no tags
 *   deck:japanese    deck name (matches descendants via "japanese::*")
 *   deck:current     currently-active deck
 *   flag:1           flag color 0–7
 *   cid:abc,def      card id list
 *   added:7          created in last 7 days (min 1)
 *   edited:7         edited in last 7 days
 *
 * State (`is:`):
 *   is:new           never reviewed
 *   is:review        in review state
 *   is:learning      (alias: learn) in learning state
 *   is:due           due now (review or learning)
 *   is:suspended     suspended
 *   is:buried        buried
 *
 * Property comparison (`prop:<name><op><number>`):
 *   prop:ivl>=10     interval (days)
 *   prop:due=0       days until due (0=today, -1=yesterday)
 *   prop:reps<10     review count
 *   prop:lapses>3    lapse count
 *   prop:ease!=2.5   ease factor
 *   Operators: < <= > >= = !=
 *
 * Special:
 *   re:pattern       regex search across front+back
 *   nc:text          ignore diacritics (no-combining)
 *   w:dog            word-boundary search
 *
 * Unqualified text:
 *   foo              substring match in front OR back OR tags
 *
 * NOT IMPLEMENTED (Reki has no equivalent data):
 *   note:, card:, mid:, nid:, dupe:, prop:s/d/r/pos, rated:, resched:,
 *   introduced:, has-cd:, preset:, sc:
 */

import type { Card, Deck } from './stores/data';

export interface QueryContext {
  decks: Deck[];
  now: number;
  currentDeckId?: string | null;
}

export interface ParseResult {
  matches: (cards: Card[], ctx: QueryContext) => Card[];
  error: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Tokenizer
// ─────────────────────────────────────────────────────────────────────

interface Token {
  field: string | null;
  value: string;
  negated: boolean;
  // Whether the value contains wildcards (compiled later as regex)
  hasWildcards: boolean;
  // Whether the original value was quoted (affects matching mode)
  quoted: boolean;
}

interface BoolTok { kind: 'and' | 'or' }
interface ParenTok { kind: 'lparen' | 'rparen' }
interface TermTok { kind: 'term'; tok: Token }
type Tok = BoolTok | ParenTok | TermTok;

const WS = /[\s\u3000]/;

function tokenize(input: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];
    if (WS.test(ch)) { i++; continue; }

    if (ch === '(') { out.push({ kind: 'lparen' }); i++; continue; }
    if (ch === ')') { out.push({ kind: 'rparen' }); i++; continue; }

    let negated = false;
    if (ch === '-' && i + 1 < n && !WS.test(input[i + 1]) && input[i + 1] !== ')') {
      negated = true;
      i++;
    }

    // Optional field prefix
    let field: string | null = null;
    const fieldRe = /^([a-zA-Z][a-zA-Z0-9-]*):/;
    const m = input.slice(i).match(fieldRe);
    if (m) {
      field = m[1].toLowerCase();
      i += m[0].length;
    }

    // Read value
    let value = '';
    let quoted = false;
    let hasWildcards = false;

    if (input[i] === '"') {
      quoted = true;
      i++;
      while (i < n && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < n) {
          const next = input[i + 1];
          if (next === '"' || next === '\\') {
            value += next;
            i += 2;
            continue;
          }
        }
        value += input[i];
        i++;
      }
      if (i < n) i++; // closing quote
    } else {
      while (i < n) {
        const c = input[i];
        if (WS.test(c) || c === '(' || c === ')') break;
        if (c === '\\' && i + 1 < n) {
          const next = input[i + 1];
          if (next === '*') { value += '\\*'; hasWildcards = false; i += 2; continue; }
          if (next === '_') { value += '\\_'; i += 2; continue; }
          if ('"-(): \\'.includes(next) || WS.test(next)) {
            value += next;
            i += 2;
            continue;
          }
        }
        if (c === '*' || c === '_') hasWildcards = true;
        value += c;
        i++;
      }
    }

    // Bare AND/OR keywords
    if (!field && !negated && !quoted) {
      const upper = value.toUpperCase();
      if (upper === 'AND') { out.push({ kind: 'and' }); continue; }
      if (upper === 'OR')  { out.push({ kind: 'or' });  continue; }
    }

    if (value.length || field !== null) {
      out.push({ kind: 'term', tok: { field, value, negated, hasWildcards, quoted } });
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────
// AST
// ─────────────────────────────────────────────────────────────────────

type Predicate = (card: Card, ctx: QueryContext) => boolean;

type Node =
  | { kind: 'and'; children: Node[] }
  | { kind: 'or'; children: Node[] }
  | { kind: 'not'; child: Node }
  | { kind: 'pred'; predicate: Predicate; describe: string };

const TRUE: Node = { kind: 'pred', predicate: () => true, describe: 'true' };

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** Compile an Anki-style wildcard pattern to a RegExp.
 *  `*` → `.*`, `_` → `.`, escaped `\*`/`\_` are literal.
 *  If `exact` is true, anchors with ^ and $. */
function wildcardToRegex(pattern: string, exact: boolean, caseInsensitive = true): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) {
      const next = pattern[i + 1];
      if (next === '*' || next === '_') {
        re += escapeRegex(next);
        i++;
        continue;
      }
    }
    if (c === '*') re += '.*';
    else if (c === '_') re += '.';
    else re += escapeRegex(c);
  }
  if (exact) re = '^' + re + '$';
  return new RegExp(re, caseInsensitive ? 'iu' : 'u');
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function daysAgo(timestamp: number, now: number): number {
  return Math.floor((now - timestamp) / 86_400_000);
}

function daysUntil(timestamp: number, now: number): number {
  return Math.floor((timestamp - now) / 86_400_000);
}

// ─────────────────────────────────────────────────────────────────────
// Predicate builders for each field
// ─────────────────────────────────────────────────────────────────────

function buildFieldPredicate(tok: Token): Predicate {
  const { field, value, hasWildcards } = tok;
  const v = value;
  const lower = v.toLowerCase();

  // Bare text → match front, back, or tag substring (case-insensitive)
  if (field === null) {
    if (hasWildcards) {
      const re = wildcardToRegex(v, false, true);
      return (c) => re.test(c.front) || re.test(c.back) || c.tags.some(t => re.test(t));
    }
    return (c) =>
      c.front.toLowerCase().includes(lower) ||
      c.back.toLowerCase().includes(lower) ||
      c.tags.some(t => t.toLowerCase().includes(lower));
  }

  switch (field) {
    case 'front':
      return fieldMatcher(v, hasWildcards, c => c.front);
    case 'back':
      return fieldMatcher(v, hasWildcards, c => c.back);

    case 'deck': {
      if (lower === 'current') {
        return (c, ctx) => ctx.currentDeckId === c.deckId;
      }
      // Match deck name (case-insensitive). Hierarchical: matches descendants.
      const re = hasWildcards
        ? wildcardToRegex(v, true, true)
        : new RegExp('^' + escapeRegex(v) + '(::|$)', 'iu');
      return (c, ctx) => {
        const deck = ctx.decks.find(d => d.id === c.deckId);
        return !!deck && re.test(deck.name);
      };
    }

    case 'tag': {
      if (lower === 'none') {
        return (c) => c.tags.length === 0;
      }
      const re = hasWildcards
        ? wildcardToRegex(v, true, true)
        : new RegExp('^' + escapeRegex(v) + '(::|$)', 'iu');
      return (c) => c.tags.some(t => re.test(t));
    }

    case 'is': {
      switch (lower) {
        case 'new':       return (c) => c.state === 'new';
        case 'review':    return (c) => c.state === 'review';
        case 'learn':
        case 'learning':  return (c) => c.state === 'learning';
        case 'due':       return (c, ctx) => (c.state === 'review' || c.state === 'learning') && c.due <= ctx.now;
        case 'suspended': return (c) => c.state === 'suspended';
        case 'buried':    return (c) => c.state === 'buried';
        default:          return failPred(`Unknown is: state "${value}"`);
      }
    }

    case 'flag': {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 0 || n > 7) return failPred(`flag must be 0–7, got "${value}"`);
      return (c) => c.flag === n;
    }

    case 'added': {
      const n = Math.max(1, parseInt(v, 10));
      if (isNaN(n)) return failPred(`added: needs a number, got "${value}"`);
      return (c, ctx) => daysAgo(c.createdAt, ctx.now) < n;
    }

    case 'edited': {
      const n = Math.max(1, parseInt(v, 10));
      if (isNaN(n)) return failPred(`edited: needs a number, got "${value}"`);
      return (c, ctx) => daysAgo(c.editedAt, ctx.now) < n;
    }

    case 'cid': {
      const ids = new Set(v.split(',').map(s => s.trim()).filter(Boolean));
      return (c) => ids.has(c.id);
    }

    case 'prop': return buildPropPredicate(v);

    case 're': {
      try {
        const re = new RegExp(v, 'iu');
        return (c) => re.test(c.front) || re.test(c.back);
      } catch (e) {
        return failPred(`Invalid regex: ${e}`);
      }
    }

    case 'nc': {
      const stripped = stripDiacritics(lower);
      return (c) =>
        stripDiacritics(c.front.toLowerCase()).includes(stripped) ||
        stripDiacritics(c.back.toLowerCase()).includes(stripped);
    }

    case 'w': {
      // Word boundary search. Supports trailing/leading wildcards.
      let pattern = v;
      let leftBoundary = '\\b';
      let rightBoundary = '\\b';
      if (pattern.startsWith('*')) { leftBoundary = ''; pattern = pattern.slice(1); }
      if (pattern.endsWith('*'))   { rightBoundary = ''; pattern = pattern.slice(0, -1); }
      const re = new RegExp(leftBoundary + escapeRegex(pattern) + rightBoundary, 'iu');
      return (c) => re.test(c.front) || re.test(c.back);
    }

    default:
      return failPred(`Unknown field "${field}:"`);
  }
}

function fieldMatcher(value: string, hasWildcards: boolean, getter: (c: Card) => string): Predicate {
  if (value === '') {
    // Empty field test
    return (c) => getter(c).length === 0;
  }
  if (hasWildcards) {
    const re = wildcardToRegex(value, true, true);
    return (c) => re.test(getter(c));
  }
  // Default: exact (case-insensitive) match like Anki
  const lower = value.toLowerCase();
  return (c) => getter(c).toLowerCase() === lower;
}

function failPred(msg: string): Predicate {
  // Returning false for an unparseable predicate, but recording the message via .toString
  const fn: Predicate & { _err?: string } = () => false;
  fn._err = msg;
  return fn;
}

// prop:<name><op><number>
function buildPropPredicate(value: string): Predicate {
  const m = value.match(/^([a-zA-Z]+)(<=|>=|!=|=|<|>)(-?\d+(?:\.\d+)?)$/);
  if (!m) return failPred(`Invalid prop syntax: "${value}"`);
  const [, name, op, numStr] = m;
  const num = parseFloat(numStr);

  const cmp = (val: number) => {
    switch (op) {
      case '<':  return val < num;
      case '<=': return val <= num;
      case '>':  return val > num;
      case '>=': return val >= num;
      case '=':  return val === num;
      case '!=': return val !== num;
      default:   return false;
    }
  };

  switch (name.toLowerCase()) {
    case 'ivl':    return (c) => cmp(c.interval);
    case 'due':    return (c, ctx) => cmp(daysUntil(c.due, ctx.now));
    case 'reps':   return (c) => cmp(c.reps);
    case 'lapses': return (c) => cmp(c.lapses);
    case 'ease':   return (c) => cmp(c.ease);
    default:       return failPred(`Unsupported prop "${name}"`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Parser  (precedence: NOT > AND > OR)
// ─────────────────────────────────────────────────────────────────────

class Parser {
  private pos = 0;
  private err: string | null = null;
  constructor(private toks: Tok[]) {}

  parse(): { tree: Node; error: string | null } {
    const tree = this.parseOr();
    if (this.peek()) this.err ??= 'Unexpected trailing tokens';
    return { tree, error: this.err };
  }

  private peek(): Tok | undefined { return this.toks[this.pos]; }
  private next(): Tok | undefined { return this.toks[this.pos++]; }

  private parseOr(): Node {
    const children: Node[] = [this.parseAnd()];
    while (this.peek()?.kind === 'or') {
      this.next();
      children.push(this.parseAnd());
    }
    return children.length === 1 ? children[0] : { kind: 'or', children };
  }

  private parseAnd(): Node {
    const children: Node[] = [];
    while (true) {
      const t = this.peek();
      if (!t) break;
      if (t.kind === 'or' || t.kind === 'rparen') break;
      if (t.kind === 'and') { this.next(); continue; }
      children.push(this.parseAtom());
    }
    if (children.length === 0) return TRUE;
    if (children.length === 1) return children[0];
    return { kind: 'and', children };
  }

  private parseAtom(): Node {
    const t = this.next();
    if (!t) return TRUE;

    if (t.kind === 'lparen') {
      const inner = this.parseOr();
      const close = this.next();
      if (!close || close.kind !== 'rparen') {
        this.err ??= 'Unclosed group';
      }
      return inner;
    }

    if (t.kind === 'rparen') {
      this.err ??= 'Unexpected )';
      return TRUE;
    }

    if (t.kind === 'and' || t.kind === 'or') {
      this.err ??= `Misplaced ${t.kind.toUpperCase()}`;
      return TRUE;
    }

    // term
    const pred = buildFieldPredicate(t.tok);
    const errMsg = (pred as Predicate & { _err?: string })._err;
    if (errMsg) this.err ??= errMsg;
    const node: Node = { kind: 'pred', predicate: pred, describe: '' };
    return t.tok.negated ? { kind: 'not', child: node } : node;
  }
}

function evaluate(node: Node, card: Card, ctx: QueryContext): boolean {
  switch (node.kind) {
    case 'pred': return node.predicate(card, ctx);
    case 'not':  return !evaluate(node.child, card, ctx);
    case 'and':  return node.children.every(c => evaluate(c, card, ctx));
    case 'or':   return node.children.some(c => evaluate(c, card, ctx));
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export function parseQuery(query: string): ParseResult {
  const trimmed = query.trim();
  if (!trimmed) {
    return { matches: (cards) => cards, error: null };
  }

  try {
    const tokens = tokenize(trimmed);
    const { tree, error } = new Parser(tokens).parse();
    return {
      matches: (cards, ctx) => cards.filter(c => evaluate(tree, c, ctx)),
      error,
    };
  } catch (e) {
    return {
      matches: (cards) => cards,
      error: String(e),
    };
  }
}
