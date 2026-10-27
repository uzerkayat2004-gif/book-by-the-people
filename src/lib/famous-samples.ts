/** Fictional sample people from the original prototype. Not real public figures. */
export const FAMOUS_SAMPLES = [
  { name: "Aria Mehta", handle: "ariabuilds", col: "#c92e34", q: "I shipped more in 2026 than in my whole career and remember less of it than any year before.", t: "9:41 PM · Oct 20, 2026", r: "1.2K", rt: "3.4K", l: "21K" },
  { name: "Dev Kapoor", handle: "devkapoor", col: "#6b4cd6", q: "My students don't cheat with AI. They just never sit in the boring part long enough to learn.", t: "8:03 AM · Oct 21, 2026", r: "884", rt: "2.1K", l: "14K" },
  { name: "Sana Okafor", handle: "sanaokafor", col: "#1d8a6b", q: "The feed got smarter than my willpower. That's not a moral failure, that's a design choice.", t: "11:17 PM · Oct 19, 2026", r: "612", rt: "1.8K", l: "9.7K" },
  { name: "Theo Lindqvist", handle: "theo_l", col: "#b26a1d", q: "Used well it is a bicycle for the mind. Used badly it is an escalator to nowhere.", t: "3:26 PM · Oct 21, 2026", r: "402", rt: "1.1K", l: "7.9K" },
  { name: "Mira Castell", handle: "miracastell", col: "#1d6fb2", q: "I don't start blank pages anymore. I start with someone else's average and call it mine.", t: "6:52 PM · Oct 21, 2026", r: "530", rt: "1.6K", l: "11K" },
  { name: "Kofi Mensah", handle: "kofibuilds", col: "#8a3fb0", q: "Productivity went up. Understanding went down. My commits look great, my head feels empty.", t: "10:08 AM · Oct 20, 2026", r: "377", rt: "960", l: "6.4K" },
  { name: "Lena Hart", handle: "lenahart", col: "#b2335e", q: "The hardest skill for my clients now is staying with one thought for ten minutes.", t: "1:45 PM · Oct 19, 2026", r: "288", rt: "740", l: "5.2K" },
  { name: "Ravi Anand", handle: "ravi_anand", col: "#2f8f4e", q: "Every question has a three-second answer now. That's exactly why I stopped asking good ones.", t: "12:30 AM · Oct 22, 2026", r: "204", rt: "610", l: "4.8K" },
];

export function scramble(value: string) {
  return value.replace(/[A-Za-z]{2,}/g, (word) =>
    word
      .split("")
      .map((character, index) => "aeionrstlhudcmwy"[(character.charCodeAt(0) * 7 + index * 3) % 16])
      .join(""),
  );
}
