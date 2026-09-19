import { describe, expect, it } from 'vitest';
import { editedLabel, greeting, relativeTime } from './pages';

const NOW = new Date('2026-09-19T12:00:00.000Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('一分鐘內是「剛剛」', () => {
    expect(relativeTime(ago(10_000), NOW)).toBe('剛剛');
  });
  it('分鐘', () => {
    expect(relativeTime(ago(3 * MIN), NOW)).toBe('3 分鐘前');
    expect(relativeTime(ago(59 * MIN), NOW)).toBe('59 分鐘前');
  });
  it('小時', () => {
    expect(relativeTime(ago(2 * HOUR), NOW)).toBe('2 小時前');
  });
  it('昨天與天數', () => {
    expect(relativeTime(ago(25 * HOUR), NOW)).toBe('昨天');
    expect(relativeTime(ago(3 * DAY), NOW)).toBe('3 天前');
  });
  it('超過一週改顯示日期', () => {
    expect(relativeTime(ago(30 * DAY), NOW)).toMatch(/月/);
  });
  it('無效輸入回空字串', () => {
    expect(relativeTime(null, NOW)).toBe('');
    expect(relativeTime('not-a-date', NOW)).toBe('');
  });
  it('未來時間不會變成負數', () => {
    expect(relativeTime(new Date(NOW + HOUR).toISOString(), NOW)).toBe('剛剛');
  });
});

describe('editedLabel', () => {
  it('照 Notion 的講法組句子', () => {
    expect(editedLabel(ago(3 * MIN), NOW)).toBe('已於 3 分鐘前 編輯');
    expect(editedLabel(ago(10_000), NOW)).toBe('剛剛編輯');
  });
  it('沒有時間就不顯示', () => {
    expect(editedLabel(null, NOW)).toBe('');
  });
});

describe('greeting', () => {
  it('依時段給早安 / 午安 / 晚安', () => {
    expect(greeting('阿俊', 8)).toBe('早安，阿俊');
    expect(greeting('阿俊', 13)).toBe('午安，阿俊');
    expect(greeting('阿俊', 21)).toBe('晚安，阿俊');
    expect(greeting('阿俊', 3)).toBe('晚安，阿俊');
  });
  it('沒有名字時只給時段', () => {
    expect(greeting('', 8)).toBe('早安');
  });
});
