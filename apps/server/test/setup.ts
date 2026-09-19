/**
 * 需要真資料庫的測試走 DATABASE_URL_TEST；沒設定時那些測試會 skip 而不是失敗
 * （04 §9 的原則：本機沒有 DB 也要能跑完整套單元測試）。
 */
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
