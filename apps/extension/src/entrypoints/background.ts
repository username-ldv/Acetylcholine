import { ACETYLCHOLINE_NAME } from '@acetylcholine/shared';

export default defineBackground(() => {
  console.log(`[${ACETYLCHOLINE_NAME}] background started`, { id: browser.runtime.id });

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      void browser.runtime.openOptionsPage();
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as { type?: string } | null;
    if (msg?.type === 'ping') {
      sendResponse({ type: 'pong', at: Date.now() });
      return true;
    }
    return false;
  });
});
