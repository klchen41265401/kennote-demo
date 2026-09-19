/**
 * 斷詞 / tsquery 組裝 / 片段高亮 / cursor。
 *
 * ⚠️ 這裡的「黃金案例」同時是 migration 0020 裡 `kn_segment()` 的規格書。
 *    兩邊只要有一邊改了規則，這些斷言就必須一起改，並且要重建索引。
 */
import { describe, expect, it } from 'vitest';
import { buildTsQuery, isCjkCodePoint, parseQuery, segmentText, segmentTokens } from '../src/modules/search/segment.js';
import { buildSnippet, matchRanges, sanitizeHeadline, TS_HEADLINE_OPTIONS } from '../src/modules/search/snippet.js';
import { decodeCursor, encodeCursor } from '../src/modules/search/service.js';

describe('segmentTokens —— 與 kn_segment() 必須完全一致', () => {
  it('中文連續字元切成 bigram', () => {
    expect(segmentTokens('資料庫')).toEqual(['資料', '料庫']);
    expect(segmentTokens('資料庫設計')).toEqual(['資料', '料庫', '庫設', '設計']);
  });

  it('單一中文字保留原字（bigram 切不出來）', () => {
    expect(segmentTokens('我')).toEqual(['我']);
    expect(segmentTokens('我 你')).toEqual(['我', '你']);
  });

  it('英數詞整串小寫成一個 token', () => {
    expect(segmentTokens('Hello World 2026')).toEqual(['hello', 'world', '2026']);
    expect(segmentTokens('kennote-v2')).toEqual(['kennote', 'v2']);
  });

  it('中英混排：各自切各自的，標點是分隔符', () => {
    expect(segmentTokens('kennote 的資料庫，很讚！')).toEqual([
      'kennote',
      '的資',
      '資料',
      '料庫',
      '很讚',
    ]);
  });

  it('日文假名與韓文諺文也視為 CJK', () => {
    expect(segmentTokens('ひらがな')).toEqual(['ひら', 'らが', 'がな']);
    expect(segmentTokens('한국어')).toEqual(['한국', '국어']);
  });

  it('空字串 / 純標點 → 沒有 token', () => {
    expect(segmentTokens('')).toEqual([]);
    expect(segmentTokens('，。！？ ---')).toEqual([]);
  });

  it('emoji 不是 CJK，是分隔符', () => {
    expect(segmentTokens('筆記📝系統')).toEqual(['筆記', '系統']);
  });

  it('segmentText 用空白串接（= kn_segment 的回傳格式）', () => {
    expect(segmentText('資料庫 abc')).toBe('資料 料庫 abc');
    expect(segmentText('')).toBe('');
  });

  it('isCjkCodePoint 的邊界', () => {
    expect(isCjkCodePoint('中'.codePointAt(0)!)).toBe(true);
    expect(isCjkCodePoint('a'.codePointAt(0)!)).toBe(false);
    expect(isCjkCodePoint('，'.codePointAt(0)!)).toBe(false);
  });
});

describe('buildTsQuery', () => {
  it('token 以 & 串接並各自加單引號', () => {
    expect(buildTsQuery(['資料', '料庫'], { prefixLast: false })).toBe("'資料' & '料庫'");
  });

  it('最後一個英數詞做前綴比對（type-ahead）', () => {
    expect(buildTsQuery(['hello', 'wor'])).toBe("'hello' & 'wor':*");
  });

  it('CJK bigram 不做前綴比對', () => {
    expect(buildTsQuery(['資料', '料庫'])).toBe("'資料' & '料庫'");
  });

  it('沒有 token 時回 null', () => {
    expect(buildTsQuery([])).toBeNull();
  });

  it('token 只會是英數或 CJK，天然不可能注入', () => {
    const parsed = parseQuery("'; DROP TABLE pages; --");
    expect(parsed.tsquery).not.toContain(';');
    expect(parsed.tokens.every((t) => /^[0-9a-z]+$/.test(t))).toBe(true);
  });
});

describe('parseQuery', () => {
  it('去重但保留順序', () => {
    expect(parseQuery('abc abc def').tokens).toEqual(['abc', 'def']);
  });

  it('單一中文字要走 trgm fallback', () => {
    expect(parseQuery('我').needsTrigramFallback).toBe(true);
    expect(parseQuery('資料庫').needsTrigramFallback).toBe(false);
  });

  it('空查詢：沒有 token、要 fallback', () => {
    const parsed = parseQuery('   ');
    expect(parsed.raw).toBe('');
    expect(parsed.tokens).toEqual([]);
    expect(parsed.needsTrigramFallback).toBe(true);
  });
});

describe('buildSnippet', () => {
  it('把命中處包 <mark>，其餘逸出', () => {
    const html = buildSnippet('這是資料庫設計文件 <script>', segmentTokens('資料庫'));
    expect(html).toContain('<mark>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('重疊的 bigram 會合併成一段 mark', () => {
    const html = buildSnippet('資料庫設計', segmentTokens('資料庫'));
    expect(html).toBe('<mark>資料庫</mark>設計');
  });

  it('長文只取命中附近的視窗，前後補省略號', () => {
    const text = `${'前'.repeat(300)}關鍵字${'後'.repeat(300)}`;
    const html = buildSnippet(text, segmentTokens('關鍵字'), { maxLength: 60 });
    expect(html.startsWith('…')).toBe(true);
    expect(html.endsWith('…')).toBe(true);
    expect(html).toContain('<mark>關鍵字</mark>');
  });

  it('完全沒命中 → 回開頭的一段（不是空字串）', () => {
    expect(buildSnippet('完全無關的內容', segmentTokens('zzz'))).toContain('完全無關');
    expect(buildSnippet('完全無關的內容', segmentTokens('zzz'), { fallbackToHead: false })).toBe('');
  });

  it('空內容回空字串', () => {
    expect(buildSnippet('', ['abc'])).toBe('');
  });

  it('matchRanges 合併重疊區間', () => {
    expect(matchRanges('aaaa', ['aa'])).toEqual([{ start: 0, end: 4 }]);
  });
});

describe('ts_headline 的哨兵處理', () => {
  it('逸出內容但保留 <mark>', () => {
    const start = TS_HEADLINE_OPTIONS.match(/StartSel=([^,]+)/)![1]!;
    const stop = TS_HEADLINE_OPTIONS.match(/StopSel=([^,]+)/)![1]!;
    const raw = `a <b> ${start}hit${stop} c`;
    const html = sanitizeHeadline(raw);
    expect(html).toBe('a &lt;b&gt; <mark>hit</mark> c');
  });
});

describe('cursor', () => {
  it('encode / decode 往返', () => {
    expect(decodeCursor(encodeCursor(40))).toBe(40);
  });

  it('壞掉的 cursor 退回第一頁而不是丟錯', () => {
    expect(decodeCursor('not-base64!!')).toBe(0);
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor(encodeCursor(-5))).toBe(0);
  });

  it('offset 有上限，防止有人手刻超大 cursor 掃全表', () => {
    expect(decodeCursor(encodeCursor(999999))).toBe(1000);
  });
});
