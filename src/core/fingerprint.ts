export function hashFingerprint(...parts: (string | number)[]): string {
  const str = parts.join("|");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `bug_${Math.abs(hash).toString(36)}`;
}
