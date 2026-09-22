/**
 * Scanner: watches the pointer, extracts the text under it when the trigger condition holds,
 * asks for a lookup, and reports the result together with the matched range.
 */
import {
  getLanguageAdapter,
  type LanguageAdapter,
  type LookupResult,
  type ScanningOptions,
} from '@acetylcholine/shared';
import {
  type CaretHit,
  caretFromPoint,
  extractSentence,
  extractText,
  rangeForLength,
  type ScannedText,
  type SentenceParts,
} from './text.ts';

export interface ScanHit {
  result: LookupResult;
  scanned: ScannedText;
  /** Range of the longest match, or null when nothing matched. */
  range: Range | null;
  /** The sentence around the match (for Anki), or null when nothing matched. */
  sentence: SentenceParts | null;
}

export interface ScannerOptions {
  scanning: ScanningOptions;
  language: string;
}

export interface ScannerCallbacks {
  lookup: (text: string) => Promise<LookupResult>;
  onHit: (hit: ScanHit) => void;
  /** Called on user actions that should dismiss the popup (click outside, Escape, scroll). */
  onDismiss: (reason: 'click' | 'escape' | 'scroll') => void;
  /** Elements that belong to the popup and must not trigger scans or dismissal. */
  isPopupTarget: (target: EventTarget | null) => boolean;
}

export class Scanner {
  private options: ScanningOptions;
  private adapter: LanguageAdapter;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastKey: string | null = null;
  private lookupSeq = 0;
  private enabled = true;

  constructor(
    private readonly doc: Document,
    options: ScannerOptions,
    private readonly callbacks: ScannerCallbacks,
  ) {
    this.options = options.scanning;
    this.adapter = getLanguageAdapter(options.language);
  }

  start(): void {
    const d = this.doc;
    d.addEventListener('mousemove', this.onMouseMove, { passive: true });
    d.addEventListener('mousedown', this.onMouseDown, true);
    d.addEventListener('click', this.onClick, true);
    d.addEventListener('keydown', this.onKeyDown, true);
    d.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
  }

  stop(): void {
    const d = this.doc;
    d.removeEventListener('mousemove', this.onMouseMove);
    d.removeEventListener('mousedown', this.onMouseDown, true);
    d.removeEventListener('click', this.onClick, true);
    d.removeEventListener('keydown', this.onKeyDown, true);
    d.removeEventListener('scroll', this.onScroll, true);
    this.cancelPending();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancelPending();
  }

  configure(options: ScannerOptions): void {
    this.options = options.scanning;
    this.adapter = getLanguageAdapter(options.language);
    this.lastKey = null;
  }

  /** Forget the last scanned position so the same text can be scanned again. */
  reset(): void {
    this.lastKey = null;
  }

  private modifierHeld(event: MouseEvent | KeyboardEvent): boolean {
    switch (this.options.modifier) {
      case 'shift':
        return event.shiftKey;
      case 'ctrl':
        return event.ctrlKey || event.metaKey;
      case 'alt':
        return event.altKey;
      case 'none':
        return true;
    }
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.enabled || this.options.trigger !== 'hover') return;
    if (this.callbacks.isPopupTarget(event.target)) return;
    if (!this.modifierHeld(event)) {
      this.cancelPending();
      return;
    }
    if (this.isIgnored(event.target)) return;
    const { clientX: x, clientY: y } = event;
    this.cancelPending();
    if (this.options.delay > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.scanAt(x, y);
      }, this.options.delay);
    } else {
      void this.scanAt(x, y);
    }
  };

  private readonly onClick = (event: MouseEvent): void => {
    if (!this.enabled || this.options.trigger !== 'click') return;
    if (this.callbacks.isPopupTarget(event.target)) return;
    if (!this.modifierHeld(event) || this.isIgnored(event.target)) return;
    this.lastKey = null;
    void this.scanAt(event.clientX, event.clientY);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (this.callbacks.isPopupTarget(event.target)) return;
    // A click that starts a new scan (click trigger + modifier) must not dismiss first.
    if (this.options.trigger === 'click' && this.modifierHeld(event)) return;
    this.callbacks.onDismiss('click');
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.callbacks.onDismiss('escape');
  };

  private readonly onScroll = (): void => {
    if (this.options.closeOnScroll) this.callbacks.onDismiss('scroll');
  };

  private isIgnored(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    for (const selector of this.options.ignoreSelectors) {
      try {
        if (target.closest(selector)) return true;
      } catch {
        // invalid selector: ignore it
      }
    }
    return false;
  }

  private cancelPending(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async scanAt(x: number, y: number): Promise<void> {
    const hit = caretFromPoint(x, y, this.doc);
    if (!hit) return;
    if (!this.adapter.isTextChar(charAt(hit))) return;
    const key = `${nodeKey(hit.node)}:${hit.offset}`;
    if (key === this.lastKey) return;
    const scanned = extractText(hit, this.options.scanLength, this.adapter.isTextChar, this.doc);
    if (scanned.text.length === 0) return;
    this.lastKey = key;
    const seq = ++this.lookupSeq;
    let result: LookupResult;
    try {
      result = await this.callbacks.lookup(scanned.text);
    } catch (err) {
      console.warn('[Acetylcholine] lookup failed', err);
      this.lastKey = null;
      return;
    }
    if (seq !== this.lookupSeq) return; // superseded by a newer scan
    const range =
      result.matchLength > 0 ? rangeForLength(scanned, result.matchLength, this.doc) : null;
    let sentence: SentenceParts | null = null;
    if (range) {
      try {
        sentence = extractSentence(range, this.doc);
      } catch (err) {
        console.warn('[Acetylcholine] sentence extraction failed', err);
      }
    }
    this.callbacks.onHit({ result, scanned, range, sentence });
  }
}

function charAt(hit: CaretHit): string {
  const data = hit.node.data;
  const code = data.charCodeAt(hit.offset);
  const size = code >= 0xd800 && code <= 0xdbff ? 2 : 1;
  return data.slice(hit.offset, hit.offset + size);
}

const nodeIds = new WeakMap<Node, number>();
let nextNodeId = 1;
function nodeKey(node: Node): number {
  let id = nodeIds.get(node);
  if (id === undefined) {
    id = nextNodeId++;
    nodeIds.set(node, id);
  }
  return id;
}
