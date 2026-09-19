/**
 * CSS helpers shared by converters.
 */
import { transformCssRules } from '@acetylcholine/ace';

const READING_TAG_ATTRIBUTE = 'data-sc-reading-tag';

/**
 * Removes every rule whose selector mentions `data-sc-reading-tag`, including nested rules and
 * rules inside at-rule blocks. Yomitan editions of a dictionary use such rules to hide the reading
 * system they do not represent; in `.ace` the renderer decides which reading tag to show, so these
 * rules must not survive conversion. Declarations, comments, and strings are preserved elsewhere.
 */
export function stripReadingTagRules(css: string): string {
  if (!css.includes(READING_TAG_ATTRIBUTE)) return css;
  return transformCssRules(css, (rule) =>
    rule.prelude.includes(READING_TAG_ATTRIBUTE) ? null : rule.prelude,
  );
}

/**
 * Rewrites `html` and `body` selectors to the content root. Dictionary content is rendered inside
 * a shadow root where neither element exists, so MDX stylesheets like `body { font-family: … }`
 * would otherwise never apply.
 */
export function rewriteRootSelectors(css: string, root = '.ace-html'): string {
  if (!/\b(?:html|body)\b/i.test(css)) return css;
  return transformCssRules(css, (rule) => {
    if (rule.isAtRule) return rule.prelude;
    return rule.prelude
      .replace(/\bhtml\s+body\b/gi, 'body')
      .replace(/(^|[\s,>+~(])(?:html|body)(?![\w-])/gi, `$1${root}`);
  });
}
