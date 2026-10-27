export type SampleLine = { original: string; english: string };

export const SAMPLE_LINES: Record<string, SampleLine[]> = {
  en: [
    {
      original: "It makes me faster at the boring parts and slower at the thinking, and I have not decided which one matters more.",
      english: "It makes me faster at the boring parts and slower at the thinking, and I have not decided which one matters more.",
    },
    {
      original: "I use it to argue with my own draft. The day I accept the first answer is the day it makes me lazier.",
      english: "I use it to argue with my own draft. The day I accept the first answer is the day it makes me lazier.",
    },
  ],
  hinglish: [
    {
      original: "AI makes me smarter at office work yaar, but at night I get lazy and just let it write everything.",
      english: "AI makes me smarter at office work yaar, but at night I get lazy and just let it write everything.",
    },
  ],
  es: [
    {
      original: "Me ahorra tiempo, pero también me quita las ganas de pensar el primer borrador.",
      english: "It saves me time, but it also takes away the will to think through the first draft.",
    },
    {
      original: "Me vuelve más rápido, no más inteligente. La pereza llega cuando dejo de comprobar lo que escribió.",
      english: "It makes me faster, not smarter. The laziness arrives when I stop checking what it wrote.",
    },
  ],
  fr: [
    {
      original: "J'apprends plus vite, mais j'oublie aussi plus vite, parce que je ne retiens plus ce que je n'ai pas formulé moi-même.",
      english: "I learn faster, but I also forget faster, because I no longer retain what I did not phrase myself.",
    },
  ],
  hi: [
    {
      original: "यह मुझे तेज़ बनाता है, पर जब मैं जाँच नहीं करता तो मैं आलसी हो जाता हूँ।",
      english: "It makes me faster, but when I do not check I become lazy.",
    },
  ],
  de: [
    {
      original: "Es macht mich schneller, aber fauler, sobald ich die erste Antwort einfach stehen lasse.",
      english: "It makes me faster, but lazier as soon as I just leave the first answer standing.",
    },
  ],
  pt: [
    {
      original: "Fico mais rápido no trabalho chato e mais preguiçoso na hora de pensar sozinho.",
      english: "I get faster at the boring work and lazier when it is time to think for myself.",
    },
  ],
  ar: [
    {
      original: "يجعلني أسرع في العمل الممل وأكثر كسلاً حين أقبل أول جواب.",
      english: "It makes me faster at dull work and lazier when I accept the first answer.",
    },
  ],
  ja: [
    {
      original: "作業は速くなる。でも自分で考えなくなると、怠けているのだと思う。",
      english: "The work gets faster. But when I stop thinking for myself, I think I am getting lazy.",
    },
  ],
  zh: [
    {
      original: "它让我更快完成杂事，可我一接受第一个答案，人就变懒了。",
      english: "It lets me finish the chores faster, but the moment I accept the first answer I get lazy.",
    },
  ],
};

export function hashString(value: string): number {
  let hash = 0;
  for (const character of value) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return hash;
}

export function sampleLine(language: string, seed: string): SampleLine {
  const bank = SAMPLE_LINES[language] ?? SAMPLE_LINES.en;
  return bank[hashString(`${language}:${seed}`) % bank.length];
}
