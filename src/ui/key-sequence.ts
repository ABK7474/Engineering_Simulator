// Gizli tuş dizisi (ör. test kodu "681"): son basılan karakterler diziyle bitince true döner.

export function keySequence(code: string): (char: string) => boolean {
  let typed = '';
  return (char) => {
    typed = (typed + char).slice(-code.length);
    if (typed !== code) return false;
    typed = '';
    return true;
  };
}

/** Klavye olayından rakam (üst sıra ya da sayısal tuş takımı); rakam değilse boş. */
export const digitOf = (code: string): string => /^(?:Digit|Numpad)(\d)$/.exec(code)?.[1] ?? '';
