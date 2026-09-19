import { describe, expect, it } from 'vitest';
import { describeDevice, formatSessionTime } from './device';

describe('describeDevice', () => {
  it('Edge / Opera 的 UA 裡也有 Chrome，不能被認成 Chrome', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      ),
    ).toBe('Edge・Windows');
    expect(
      describeDevice(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
      ),
    ).toBe('Opera・macOS');
  });

  it('Chrome 的 UA 裡也有 Safari，不能被認成 Safari', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome・Windows');
  });

  it('認得 Safari / Firefox 與行動裝置', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari・iOS');
    expect(describeDevice('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe(
      'Firefox・Linux',
    );
    expect(
      describeDevice(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome・Android');
  });

  it('沒有 UA（或認不出來）時給得出可以顯示的字串', () => {
    expect(describeDevice(null)).toBe('未知裝置');
    expect(describeDevice(undefined)).toBe('未知裝置');
    expect(describeDevice('')).toBe('未知裝置');
    expect(describeDevice('curl/8.4.0')).toBe('瀏覽器・未知系統');
  });
});

describe('formatSessionTime', () => {
  it('壞掉的時間字串不會讓整頁爆炸', () => {
    expect(formatSessionTime('not-a-date')).toBe('—');
  });

  it('合法的 ISO 時間回得出非空字串', () => {
    expect(formatSessionTime('2026-01-05T08:30:00.000Z')).not.toBe('—');
  });
});
