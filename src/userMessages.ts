export function userMessagePreview(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function userMessageNeedsCollapse(text: string, maxPreviewLength = 96): boolean {
  return /[\r\n]/.test(text) || userMessagePreview(text).length > maxPreviewLength;
}
