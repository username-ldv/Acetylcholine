/**
 * Hosts the lookup popup: an iframe pointing at the extension's `lookup.html`, positioned next
 * to the scanned text and driven through `postMessage`.
 */
import {
  isPopupMessage,
  type LookupResult,
  type PopupInbound,
  type PopupOutbound,
  type PopupProfileOptions,
} from '@acetylcholine/shared';

export interface PopupGeometry {
  width: number;
  height: number;
  offset: number;
}

export interface PopupHostEvents {
  onClose?: () => void;
}

const FRAME_ID = 'acetylcholine-popup';

export class PopupHost {
  private frame: HTMLIFrameElement | null = null;
  private ready = false;
  private pending: PopupInbound[] = [];
  private visible = false;
  private anchor: DOMRect | null = null;
  private contentHeight = 0;
  private geometry: PopupGeometry = { width: 480, height: 360, offset: 10 };
  private readonly origin: string;

  constructor(
    private readonly doc: Document,
    private readonly events: PopupHostEvents = {},
  ) {
    this.origin = new URL(browser.runtime.getURL('/lookup.html')).origin;
    doc.defaultView?.addEventListener('message', this.onMessage);
  }

  get element(): HTMLIFrameElement | null {
    return this.frame;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  contains(target: EventTarget | null): boolean {
    return !!this.frame && target === this.frame;
  }

  setGeometry(geometry: PopupGeometry): void {
    this.geometry = geometry;
    if (this.frame) {
      this.frame.style.setProperty('width', `${geometry.width}px`, 'important');
      this.applyHeight();
      if (this.visible && this.anchor) this.position(this.anchor);
    }
  }

  show(result: LookupResult, options: PopupProfileOptions, anchor: DOMRect): void {
    const frame = this.ensureFrame();
    this.anchor = anchor;
    this.post({ type: 'acetylcholine:show', result, options });
    frame.style.setProperty('display', 'block', 'important');
    this.visible = true;
    this.position(anchor);
  }

  updateOptions(options: PopupProfileOptions): void {
    if (this.frame) this.post({ type: 'acetylcholine:options', options });
  }

  hide(): void {
    if (!this.frame || !this.visible) return;
    this.frame.style.setProperty('display', 'none', 'important');
    this.visible = false;
    this.post({ type: 'acetylcholine:hidden' });
  }

  /** Re-positions after scrolling or resizing, keeping the popup attached to the text. */
  reposition(anchor?: DOMRect): void {
    if (anchor) this.anchor = anchor;
    if (this.visible && this.anchor) this.position(this.anchor);
  }

  destroy(): void {
    this.doc.defaultView?.removeEventListener('message', this.onMessage);
    this.frame?.remove();
    this.frame = null;
    this.ready = false;
    this.visible = false;
  }

  private ensureFrame(): HTMLIFrameElement {
    if (this.frame) return this.frame;
    const frame = this.doc.createElement('iframe');
    frame.id = FRAME_ID;
    frame.setAttribute('aria-label', 'Acetylcholine dictionary popup');
    const style = frame.style;
    const set = (name: string, value: string) => style.setProperty(name, value, 'important');
    set('all', 'initial');
    set('position', 'fixed');
    set('z-index', '2147483647');
    set('top', '0');
    set('left', '0');
    set('width', `${this.geometry.width}px`);
    set('height', `${this.geometry.height}px`);
    set('border', '1px solid rgba(0,0,0,.25)');
    set('border-radius', '8px');
    set('box-shadow', '0 8px 24px rgba(0,0,0,.25)');
    set('background', 'transparent');
    set('display', 'none');
    set('color-scheme', 'light dark');
    set('opacity', '1');
    set('visibility', 'visible');
    set('pointer-events', 'auto');
    frame.src = browser.runtime.getURL('/lookup.html');
    (this.doc.body ?? this.doc.documentElement).appendChild(frame);
    this.frame = frame;
    return frame;
  }

  private post(message: PopupInbound): void {
    if (!this.frame) return;
    if (!this.ready) {
      this.pending.push(message);
      return;
    }
    this.frame.contentWindow?.postMessage(message, this.origin);
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (!this.frame || event.source !== this.frame.contentWindow) return;
    if (event.origin !== this.origin) return;
    if (!isPopupMessage(event.data)) return;
    const msg = event.data as PopupOutbound;
    switch (msg.type) {
      case 'acetylcholine:ready': {
        this.ready = true;
        const queued = this.pending;
        this.pending = [];
        for (const m of queued) this.post(m);
        break;
      }
      case 'acetylcholine:close':
        this.hide();
        this.events.onClose?.();
        break;
      case 'acetylcholine:size':
        this.contentHeight = msg.height;
        this.applyHeight();
        if (this.visible && this.anchor) this.position(this.anchor);
        break;
      case 'acetylcholine:activity':
        break;
    }
  };

  private applyHeight(): void {
    if (!this.frame) return;
    const max = this.geometry.height;
    const height = this.contentHeight > 0 ? Math.min(this.contentHeight + 2, max) : max;
    this.frame.style.setProperty('height', `${Math.max(height, 48)}px`, 'important');
  }

  private position(anchor: DOMRect): void {
    if (!this.frame) return;
    const view = this.doc.defaultView;
    if (!view) return;
    const vw = view.innerWidth;
    const vh = view.innerHeight;
    const width = Math.min(this.geometry.width, vw - 8);
    const height = Number.parseFloat(this.frame.style.height) || this.geometry.height;
    const gap = this.geometry.offset;

    let top: number;
    const below = anchor.bottom + gap;
    const above = anchor.top - gap - height;
    if (below + height <= vh) top = below;
    else if (above >= 0) top = above;
    else top = Math.max(4, Math.min(below, vh - height - 4));

    let left = anchor.left;
    if (left + width > vw - 4) left = vw - 4 - width;
    if (left < 4) left = 4;

    this.frame.style.setProperty('width', `${width}px`, 'important');
    this.frame.style.setProperty('top', `${Math.round(top)}px`, 'important');
    this.frame.style.setProperty('left', `${Math.round(left)}px`, 'important');
  }
}
