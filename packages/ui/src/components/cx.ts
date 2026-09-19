/** 極簡的 className 組合工具（不裝 clsx）。 */
export function cx(...parts: Array<string | number | false | null | undefined>): string {
  let out = '';
  for (const p of parts) {
    if (!p) continue;
    const str = String(p);
    out = out ? `${out} ${str}` : str;
  }
  return out;
}
