/** Host permission for the AnkiConnect origin (requested when the integration is switched on). */

export function originPattern(url: string): string {
  return `${new URL(url).origin}/*`;
}

/** Must run inside a user gesture (a click handler); resolves to whether access was granted. */
export async function requestOriginPermission(
  url: string,
): Promise<{ granted: boolean; origin: string }> {
  const origin = originPattern(url);
  const granted = await browser.permissions.request({ origins: [origin] });
  return { granted, origin };
}

export async function hasOriginPermission(url: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [originPattern(url)] });
  } catch {
    return false;
  }
}
