import { describe, expect, it } from 'vitest';
import { escapeHtml, formatNum, formatShort, moodText, targetText } from '../../src/ui/format';

describe('escapeHtml', () => {
  it('escapes the five HTML-sensitive characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#039;&amp;&#039;&lt;/a&gt;');
  });

  it('treats null/undefined as an empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('formatNum', () => {
  it('adds thousands separators for values >= 1000', () => {
    expect(formatNum(1234567)).toBe((1234567).toLocaleString());
  });

  it('rounds to one decimal for small values', () => {
    expect(formatNum(3.14159)).toBe('3.1');
    expect(formatNum(3)).toBe('3');
  });

  it('returns an em dash for non-finite input', () => {
    expect(formatNum(NaN)).toBe('—');
    expect(formatNum(undefined)).toBe('—');
    expect(formatNum(Infinity)).toBe('—');
  });
});

describe('moodText / targetText', () => {
  it('maps known action/target keys to their cute wording', () => {
    expect(moodText('golden-cookie')).toBe('grabbing a shiny ^w^');
    expect(targetText('big cookie')).toBe('the big cookie');
  });

  it('passes unknown keys through unchanged', () => {
    expect(moodText('some-future-action')).toBe('some-future-action');
    expect(targetText('some-future-target')).toBe('some-future-target');
  });
});

describe('formatShort', () => {
  it('keeps three significant digits with a suffix', () => {
    expect(formatShort(777)).toBe('777');
    expect(formatShort(77777)).toBe('77.8K');
    expect(formatShort(77777777)).toBe('77.8M');
    expect(formatShort(1234)).toBe('1.23K');
    expect(formatShort(2.5e15)).toBe('2.5Qa');
  });

  it('shows a dash for non-numbers', () => {
    expect(formatShort(NaN)).toBe('—');
  });
});
