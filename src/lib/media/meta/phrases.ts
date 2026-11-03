/**
 * The few lines the narrator and the film say themselves, in every language a Meta voice can read.
 * Kept short and plain. Browser safe.
 */
type Phrases = {
  /** Leads into a quote the book did not introduce. */
  named: (name: string, city: string) => string;
  anon: (city: string) => string;
  /** "A book written by 92 people from 10 countries." */
  intro: (people: number, countries: number) => string;
  /** The last line of the audiobook. */
  end: (people: number) => string;
  /** On screen in the opening scene: "92 voices", "from 10 countries". */
  voices: (people: number) => string;
  countries: (countries: number) => string;
};

/** A count as people read it on screen (1,500). */
const n = (value: number) => value.toLocaleString("en-US");
const plural = (lang: string, n: number) => new Intl.PluralRules(lang).select(n);
const ro = (n: number) => (n % 100 >= 20 || (n >= 100 && n % 100 === 0) ? `${n} de` : `${n}`);

const PHRASES: Record<string, Phrases> = {
  en: {
    named: (name, city) => `As ${name}${city ? ` from ${city}` : ""} put it: `,
    anon: (city) => `As one person in ${city} put it: `,
    intro: (p, c) => `A book written by ${p === 1 ? "one person" : `${p} people`}${c > 1 ? ` from ${c} countries` : c === 1 ? " from one country" : ""}.`,
    end: (p) => `This book was made from the voices of ${p} ${p === 1 ? "person" : "people"}. Thank you for listening.`,
    voices: (p) => `${n(p)} ${p === 1 ? "voice" : "voices"}`,
    countries: (c) => `from ${n(c)} ${c === 1 ? "country" : "countries"}`,
  },
  hi: {
    named: (name, city) => (city ? `जैसा ${city} के ${name} ने कहा: ` : `जैसा ${name} ने कहा: `),
    anon: (city) => `जैसा ${city} के एक व्यक्ति ने कहा: `,
    intro: (p, c) => (c > 0 ? `${c} देशों के ${p} लोगों की लिखी एक किताब।` : `${p} लोगों की लिखी एक किताब।`),
    end: (p) => `यह किताब ${p} लोगों की आवाज़ों से बनी है। सुनने के लिए धन्यवाद।`,
    voices: (p) => `${n(p)} आवाज़ें`,
    countries: (c) => `${n(c)} देशों से`,
  },
  es: {
    named: (name, city) => `Como dijo ${name}${city ? `, de ${city}` : ""}: `,
    anon: (city) => `Como dijo alguien de ${city}: `,
    intro: (p, c) => `Un libro escrito por ${p === 1 ? "una persona" : `${p} personas`}${c > 1 ? ` de ${c} países` : c === 1 ? " de un país" : ""}.`,
    end: (p) => `Este libro se hizo con las voces de ${p} ${p === 1 ? "persona" : "personas"}. Gracias por escuchar.`,
    voices: (p) => `${n(p)} ${p === 1 ? "voz" : "voces"}`,
    countries: (c) => `de ${n(c)} ${c === 1 ? "país" : "países"}`,
  },
  fr: {
    named: (name, city) => `Comme l'a dit ${name}${city ? `, de ${city}` : ""} : `,
    anon: (city) => `Comme l'a dit quelqu'un à ${city} : `,
    intro: (p, c) => `Un livre écrit par ${p === 1 ? "une personne" : `${p} personnes`}${c > 1 ? ` de ${c} pays` : c === 1 ? " d'un pays" : ""}.`,
    end: (p) => `Ce livre est fait des voix de ${p} ${p === 1 ? "personne" : "personnes"}. Merci de votre écoute.`,
    voices: (p) => `${n(p)} ${p === 1 ? "voix" : "voix"}`,
    countries: (c) => `de ${n(c)} pays`,
  },
  de: {
    named: (name, city) => `Wie ${name}${city ? ` aus ${city}` : ""} sagte: `,
    anon: (city) => `Wie jemand aus ${city} sagte: `,
    intro: (p, c) => `Ein Buch, geschrieben von ${p === 1 ? "einem Menschen" : `${p} Menschen`}${c > 1 ? ` aus ${c} Ländern` : c === 1 ? " aus einem Land" : ""}.`,
    end: (p) => `Dieses Buch entstand aus den Stimmen von ${p === 1 ? "einem Menschen" : `${p} Menschen`}. Danke fürs Zuhören.`,
    voices: (p) => `${n(p)} ${p === 1 ? "Stimme" : "Stimmen"}`,
    countries: (c) => `aus ${n(c)} ${c === 1 ? "Land" : "Ländern"}`,
  },
  ar: {
    named: (name, city) => `كما قال ${name}${city ? ` من ${city}` : ""}: `,
    anon: (city) => `كما قال أحدهم من ${city}: `,
    intro: (p, c) => {
      const people = plural("ar", p) === "few" ? "أشخاص" : plural("ar", p) === "many" ? "شخصًا" : "شخص";
      const lands = plural("ar", c) === "few" ? "دول" : "دولة";
      return c > 0 ? `كتاب كتبه ${p} ${people} من ${c} ${lands}.` : `كتاب كتبه ${p} ${people}.`;
    },
    end: (p) => `صُنع هذا الكتاب من أصوات ${p} ${plural("ar", p) === "few" ? "أشخاص" : plural("ar", p) === "many" ? "شخصًا" : "شخص"}. شكرًا على الاستماع.`,
    voices: (p) => `${n(p)} ${plural("ar", p) === "few" ? "أصوات" : "صوتًا"}`,
    countries: (c) => `من ${n(c)} ${plural("ar", c) === "few" ? "دول" : "دولة"}`,
  },
  ru: {
    named: (name, city) => `Вот слова ${name}${city ? ` из города ${city}` : ""}: `,
    anon: (city) => `Вот слова человека из города ${city}: `,
    intro: (p, c) => `Эту книгу написали ${p} ${plural("ru", p) === "few" ? "человека" : "человек"}${c > 0 ? ` из ${c} ${plural("ru", c) === "one" ? "страны" : "стран"}` : ""}.`,
    end: (p) => `Эта книга создана из голосов ${p} ${plural("ru", p) === "one" ? "человека" : "человек"}. Спасибо, что слушали.`,
    voices: (p) => `${n(p)} ${plural("ru", p) === "one" ? "голос" : plural("ru", p) === "few" ? "голоса" : "голосов"}`,
    countries: (c) => `из ${n(c)} ${plural("ru", c) === "one" ? "страны" : "стран"}`,
  },
  pt: {
    named: (name, city) => `Como disse ${name}${city ? `, de ${city}` : ""}: `,
    anon: (city) => `Como disse alguém de ${city}: `,
    intro: (p, c) => `Um livro escrito por ${p === 1 ? "uma pessoa" : `${p} pessoas`}${c > 1 ? ` de ${c} países` : c === 1 ? " de um país" : ""}.`,
    end: (p) => `Este livro foi feito com as vozes de ${p} ${p === 1 ? "pessoa" : "pessoas"}. Obrigado por ouvir.`,
    voices: (p) => `${n(p)} ${p === 1 ? "voz" : "vozes"}`,
    countries: (c) => `de ${n(c)} ${c === 1 ? "país" : "países"}`,
  },
  vi: {
    named: (name, city) => `Như ${name}${city ? ` ở ${city}` : ""} đã nói: `,
    anon: (city) => `Như một người ở ${city} đã nói: `,
    intro: (p, c) => `Một cuốn sách do ${p} người${c > 0 ? ` đến từ ${c} quốc gia` : ""} cùng viết.`,
    end: (p) => `Cuốn sách này được làm từ tiếng nói của ${p} người. Cảm ơn bạn đã lắng nghe.`,
    voices: (p) => `${n(p)} tiếng nói`,
    countries: (c) => `từ ${n(c)} quốc gia`,
  },
  ro: {
    named: (name, city) => `Cum a spus ${name}${city ? `, din ${city}` : ""}: `,
    anon: (city) => `Cum a spus cineva din ${city}: `,
    intro: (p, c) => `O carte scrisă de ${p === 1 ? "un om" : `${ro(p)} oameni`}${c > 1 ? ` din ${ro(c)} țări` : c === 1 ? " dintr-o țară" : ""}.`,
    end: (p) => `Această carte a fost făcută din vocile a ${p === 1 ? "unui om" : `${ro(p)} oameni`}. Vă mulțumim că ați ascultat.`,
    voices: (p) => (p === 1 ? "o voce" : `${ro(p)} voci`),
    countries: (c) => (c === 1 ? "dintr-o țară" : `din ${ro(c)} țări`),
  },
  yo: {
    named: (name, city) => `Gẹ́gẹ́ bí ${name}${city ? ` láti ${city}` : ""} ṣe sọ: `,
    anon: (city) => `Gẹ́gẹ́ bí ẹnì kan ní ${city} ṣe sọ: `,
    intro: (p, c) => `Ìwé tí ènìyàn ${p}${c > 0 ? ` láti orílẹ̀-èdè ${c}` : ""} kọ.`,
    end: (p) => `Ohùn ènìyàn ${p} ni a fi ṣe ìwé yìí. A dúpẹ́ pé ẹ gbọ́.`,
    voices: (p) => `ohùn ${n(p)}`,
    countries: (c) => `láti orílẹ̀-èdè ${n(c)}`,
  },
};

/** The phrases for a language (by its base code), English when there are none yet. */
export function phrasesFor(lang: string | undefined): Phrases {
  return PHRASES[(lang || "en").toLowerCase().split(/[-_]/)[0]] ?? PHRASES.en;
}

export const PHRASE_LANGUAGES = Object.keys(PHRASES);
