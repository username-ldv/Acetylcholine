export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // Phase 3 replaces this with the text scanner + popup host.
    console.debug('[Acetylcholine] content script loaded on', location.href);
  },
});
