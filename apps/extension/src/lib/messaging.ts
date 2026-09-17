import {
  type BackgroundRequest,
  type BackgroundResponses,
  isBackgroundError,
} from '@acetylcholine/shared';

/** Sends a typed request to the background and unwraps its error envelope. */
export async function sendBackground<T extends BackgroundRequest>(
  request: T,
): Promise<BackgroundResponses[T['type']]> {
  const response: unknown = await browser.runtime.sendMessage(request);
  if (isBackgroundError(response)) throw new Error(response.__error);
  return response as BackgroundResponses[T['type']];
}
