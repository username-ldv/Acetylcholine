/**
 * Guesses the reading system used by a dictionary from its title and a sample of readings.
 * Returns `null` when nothing is recognisable.
 */
export function detectReadingSystem(title: string, samples: readonly string[]): string | null {
  if (/注音/.test(title)) return 'zhuyin';
  if (/拼音|pinyin/i.test(title)) return 'pinyin';

  let zhuyin = 0;
  let pinyin = 0;
  let kana = 0;
  let hangul = 0;
  let latin = 0;
  for (const s of samples) {
    if (/[㄀-ㄯㆠ-ㆿ]/.test(s)) zhuyin++;
    else if (/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛü]/.test(s)) pinyin++;
    else if (/[぀-ヿ]/.test(s)) kana++;
    else if (/[가-힯ᄀ-ᇿ]/.test(s)) hangul++;
    else if (/^[A-Za-z0-9\s'.\-·]+$/.test(s)) latin++;
  }
  const total = samples.length;
  if (total === 0) return null;
  const best = [
    ['zhuyin', zhuyin],
    ['pinyin', pinyin],
    ['kana', kana],
    ['hangul', hangul],
    ['latin', latin],
  ].sort((a, b) => (b[1] as number) - (a[1] as number))[0]!;
  if ((best[1] as number) / total < 0.3) return null;
  return best[0] as string;
}
