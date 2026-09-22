import { getActiveProfile, type Profile, type Settings } from '@acetylcholine/shared';
import { sendBackground } from '$lib/messaging';
import { popupOptionsFromProfile } from '$lib/popup/options';
import { MatchHighlighter } from '$lib/scanner/highlight';
import { PopupHost } from '$lib/scanner/popup-host';
import { Scanner } from '$lib/scanner/scanner';
import { loadSettings, watchSettings } from '$lib/settings-store';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: false,
  runAt: 'document_idle',
  async main() {
    if (window.top !== window) return;
    let settings: Settings;
    try {
      settings = await loadSettings();
    } catch (err) {
      console.warn('[Acetylcholine] settings unavailable', err);
      return;
    }
    let profile = getActiveProfile(settings);
    if (isExcluded(profile, location.hostname)) return;

    const highlighter = new MatchHighlighter(document);
    const host = new PopupHost(document, {
      onClose: () => {
        highlighter.clear();
        scanner.reset();
      },
    });
    host.setGeometry({
      width: profile.popup.width,
      height: profile.popup.height,
      offset: profile.popup.offset,
    });

    const scanner = new Scanner(
      document,
      { scanning: profile.scanning, language: profile.language },
      {
        lookup: (text) => sendBackground({ type: 'lookup', text }),
        onHit: ({ result, range, sentence }) => {
          if (result.matchLength === 0 || !range) return;
          highlighter.show(range);
          const rect = range.getBoundingClientRect();
          host.show(result, popupOptionsFromProfile(profile, settings), rect, {
            sentence,
            url: location.href,
            documentTitle: document.title,
          });
        },
        onDismiss: () => {
          if (!host.isVisible) return;
          host.hide();
          highlighter.clear();
          scanner.reset();
        },
        isPopupTarget: (target) => host.contains(target),
      },
    );
    scanner.start();

    window.addEventListener(
      'scroll',
      () => {
        const range = highlighter.range;
        if (host.isVisible && range) host.reposition(range.getBoundingClientRect());
      },
      { passive: true, capture: true },
    );
    window.addEventListener('resize', () => {
      const range = highlighter.range;
      if (host.isVisible && range) host.reposition(range.getBoundingClientRect());
    });

    watchSettings((next) => {
      settings = next;
      profile = getActiveProfile(settings);
      const excluded = isExcluded(profile, location.hostname);
      scanner.setEnabled(!excluded);
      scanner.configure({ scanning: profile.scanning, language: profile.language });
      host.setGeometry({
        width: profile.popup.width,
        height: profile.popup.height,
        offset: profile.popup.offset,
      });
      host.updateOptions(popupOptionsFromProfile(profile, settings));
    });
  },
});

function isExcluded(profile: Profile, hostname: string): boolean {
  for (const pattern of profile.scanning.excludedSites) {
    const p = pattern.trim().toLowerCase();
    if (!p) continue;
    const h = hostname.toLowerCase();
    if (p.startsWith('*.')) {
      const base = p.slice(2);
      if (h === base || h.endsWith(`.${base}`)) return true;
    } else if (h === p) {
      return true;
    }
  }
  return false;
}
