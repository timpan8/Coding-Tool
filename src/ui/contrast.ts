/** WCAG relative luminance and contrast ratio.
 *
 * Fifteen lines, and it turns "is this grey light enough?" into something a test can answer for
 * both themes at once, rather than something measured by eye and then quietly broken later. */
export function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value.slice(0, 6);
  const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** 4.5:1 for body text, 3:1 for large text and for the boundary of a control. */
export const AA_TEXT = 4.5;
export const AA_LARGE = 3;
