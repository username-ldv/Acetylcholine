/**
 * Highlights the matched text. Uses the CSS Custom Highlight API when available (no selection
 * side effects), otherwise the selection.
 */

const HIGHLIGHT_NAME = 'acetylcholine-match';
const STYLE_ID = 'acetylcholine-highlight-style';

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

interface CssWithHighlights {
  highlights?: HighlightRegistry;
}

declare const Highlight: { new (...ranges: Range[]): unknown } | undefined;

export class MatchHighlighter {
  private current: Range | null = null;
  private readonly useApi: boolean;

  constructor(private readonly doc: Document = document) {
    const css = (doc.defaultView as unknown as { CSS?: CssWithHighlights })?.CSS;
    this.useApi = typeof Highlight !== 'undefined' && !!css?.highlights;
    if (this.useApi) this.ensureStyle();
  }

  show(range: Range): void {
    this.current = range;
    if (this.useApi) {
      const css = (this.doc.defaultView as unknown as { CSS: CssWithHighlights }).CSS;
      css.highlights!.set(HIGHLIGHT_NAME, new Highlight!(range));
    } else {
      const sel = this.doc.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  clear(): void {
    if (!this.current) return;
    if (this.useApi) {
      const css = (this.doc.defaultView as unknown as { CSS: CssWithHighlights }).CSS;
      css.highlights!.delete(HIGHLIGHT_NAME);
    } else {
      const sel = this.doc.getSelection();
      if (sel && sel.rangeCount > 0 && sel.getRangeAt(0) === this.current) sel.removeAllRanges();
    }
    this.current = null;
  }

  get range(): Range | null {
    return this.current;
  }

  private ensureStyle(): void {
    if (this.doc.getElementById(STYLE_ID)) return;
    const style = this.doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `::highlight(${HIGHLIGHT_NAME}){background-color:rgba(255,190,0,.45);}`;
    (this.doc.head ?? this.doc.documentElement).appendChild(style);
  }
}
