import { LANGUAGES } from "./languages";

/** Concrete words a person can say in one breath. The same list, in every language. */
export const ENGLISH_START_WORDS = [
  "friend",
  "bridge",
  "planet",
  "river",
  "garden",
  "window",
  "mountain",
  "ocean",
  "candle",
  "pocket",
  "silver",
  "mango",
  "thunder",
  "castle",
  "pencil",
  "mirror",
  "forest",
  "island",
  "rocket",
  "feather",
  "hammer",
  "jacket",
  "lemon",
  "rabbit",
  "tiger",
  "umbrella",
  "cloud",
  "flower",
  "guitar",
  "market",
  "piano",
  "rainbow",
  "apple",
  "camera",
  "honey",
  "lantern",
] as const;

type Word = (typeof ENGLISH_START_WORDS)[number];

const PACKS: Record<string, readonly string[]> = {
  en: ENGLISH_START_WORDS,
  hinglish: ENGLISH_START_WORDS,
  es: [
    "amigo", "puente", "planeta", "río", "jardín", "ventana", "montaña", "océano", "vela", "bolsillo",
    "plata", "mango", "trueno", "castillo", "lápiz", "espejo", "bosque", "isla", "cohete", "pluma",
    "martillo", "chaqueta", "limón", "conejo", "tigre", "paraguas", "nube", "flor", "guitarra", "mercado",
    "piano", "arcoíris", "manzana", "cámara", "miel", "farol",
  ],
  fr: [
    "ami", "pont", "planète", "rivière", "jardin", "fenêtre", "montagne", "océan", "bougie", "poche",
    "argent", "mangue", "tonnerre", "château", "crayon", "miroir", "forêt", "île", "fusée", "plume",
    "marteau", "veste", "citron", "lapin", "tigre", "parapluie", "nuage", "fleur", "guitare", "marché",
    "piano", "arc-en-ciel", "pomme", "appareil", "miel", "lanterne",
  ],
  de: [
    "Freund", "Brücke", "Planet", "Fluss", "Garten", "Fenster", "Berg", "Ozean", "Kerze", "Tasche",
    "Silber", "Mango", "Donner", "Schloss", "Bleistift", "Spiegel", "Wald", "Insel", "Rakete", "Feder",
    "Hammer", "Jacke", "Zitrone", "Kaninchen", "Tiger", "Regenschirm", "Wolke", "Blume", "Gitarre", "Markt",
    "Klavier", "Regenbogen", "Apfel", "Kamera", "Honig", "Laterne",
  ],
  it: [
    "amico", "ponte", "pianeta", "fiume", "giardino", "finestra", "montagna", "oceano", "candela", "tasca",
    "argento", "mango", "tuono", "castello", "matita", "specchio", "foresta", "isola", "razzo", "piuma",
    "martello", "giacca", "limone", "coniglio", "tigre", "ombrello", "nuvola", "fiore", "chitarra", "mercato",
    "pianoforte", "arcobaleno", "mela", "macchina", "miele", "lanterna",
  ],
  pt: [
    "amigo", "ponte", "planeta", "rio", "jardim", "janela", "montanha", "oceano", "vela", "bolso",
    "prata", "manga", "trovão", "castelo", "lápis", "espelho", "floresta", "ilha", "foguete", "pena",
    "martelo", "jaqueta", "limão", "coelho", "tigre", "guarda-chuva", "nuvem", "flor", "violão", "mercado",
    "piano", "arco-íris", "maçã", "câmera", "mel", "lanterna",
  ],
  nl: [
    "vriend", "brug", "planeet", "rivier", "tuin", "raam", "berg", "oceaan", "kaars", "zak",
    "zilver", "mango", "donder", "kasteel", "potlood", "spiegel", "bos", "eiland", "raket", "veer",
    "hamer", "jas", "citroen", "konijn", "tijger", "paraplu", "wolk", "bloem", "gitaar", "markt",
    "piano", "regenboog", "appel", "camera", "honing", "lantaarn",
  ],
  pl: [
    "przyjaciel", "most", "planeta", "rzeka", "ogród", "okno", "góra", "ocean", "świeca", "kieszeń",
    "srebro", "mango", "grzmot", "zamek", "ołówek", "lustro", "las", "wyspa", "rakieta", "pióro",
    "młotek", "kurtka", "cytryna", "królik", "tygrys", "parasol", "chmura", "kwiat", "gitara", "rynek",
    "pianino", "tęcza", "jabłko", "aparat", "miód", "latarnia",
  ],
  tr: [
    "arkadaş", "köprü", "gezegen", "nehir", "bahçe", "pencere", "dağ", "okyanus", "mum", "cep",
    "gümüş", "mango", "gök gürültüsü", "kale", "kalem", "ayna", "orman", "ada", "roket", "tüy",
    "çekiç", "ceket", "limon", "tavşan", "kaplan", "şemsiye", "bulut", "çiçek", "gitar", "pazar",
    "piyano", "gökkuşağı", "elma", "kamera", "bal", "fener",
  ],
  id: [
    "teman", "jembatan", "planet", "sungai", "taman", "jendela", "gunung", "laut", "lilin", "saku",
    "perak", "mangga", "guntur", "istana", "pensil", "cermin", "hutan", "pulau", "roket", "bulu",
    "palu", "jaket", "lemon", "kelinci", "harimau", "payung", "awan", "bunga", "gitar", "pasar",
    "piano", "pelangi", "apel", "kamera", "madu", "lentera",
  ],
  ms: [
    "kawan", "jambatan", "planet", "sungai", "taman", "tingkap", "gunung", "lautan", "lilin", "poket",
    "perak", "mangga", "guruh", "istana", "pensel", "cermin", "hutan", "pulau", "roket", "bulu",
    "tukul", "jaket", "lemon", "arnab", "harimau", "payung", "awan", "bunga", "gitar", "pasar",
    "piano", "pelangi", "epal", "kamera", "madu", "tanglung",
  ],
  tl: [
    "kaibigan", "tulay", "planeta", "ilog", "hardin", "bintana", "bundok", "karagatan", "kandila", "bulsa",
    "pilak", "mangga", "kulog", "kastilyo", "lapis", "salamin", "gubat", "isla", "roket", "balahibo",
    "martilyo", "dyaket", "limon", "kuneho", "tigre", "payong", "ulap", "bulaklak", "gitara", "palengke",
    "piyano", "bahaghari", "mansanas", "kamera", "pulot", "parol",
  ],
  vi: [
    "bạn", "cầu", "hành tinh", "sông", "vườn", "cửa sổ", "núi", "đại dương", "nến", "túi",
    "bạc", "xoài", "sấm", "lâu đài", "bút chì", "gương", "rừng", "đảo", "tên lửa", "lông vũ",
    "búa", "áo khoác", "chanh", "thỏ", "hổ", "ô", "mây", "hoa", "đàn guitar", "chợ",
    "đàn piano", "cầu vồng", "táo", "máy ảnh", "mật ong", "đèn lồng",
  ],
  hi: [
    "दोस्त", "पुल", "ग्रह", "नदी", "बगीचा", "खिड़की", "पहाड़", "समुद्र", "मोमबत्ती", "जेब",
    "चाँदी", "आम", "गरज", "किला", "पेंसिल", "आईना", "जंगल", "द्वीप", "रॉकेट", "पंख",
    "हथौड़ा", "जैकेट", "नींबू", "खरगोश", "बाघ", "छाता", "बादल", "फूल", "गिटार", "बाज़ार",
    "पियानो", "इंद्रधनुष", "सेब", "कैमरा", "शहद", "लालटेन",
  ],
  mr: [
    "मित्र", "पूल", "ग्रह", "नदी", "बाग", "खिडकी", "डोंगर", "समुद्र", "मेणबत्ती", "खिसा",
    "चांदी", "आंबा", "गडगडाट", "किल्ला", "पेन्सिल", "आरसा", "जंगल", "बेट", "रॉकेट", "पीस",
    "हातोडा", "जाकीट", "लिंबू", "ससा", "वाघ", "छत्री", "ढग", "फूल", "गिटार", "बाजार",
    "पियानो", "इंद्रधनुष", "सफरचंद", "कॅमेरा", "मध", "कंदील",
  ],
  bn: [
    "বন্ধু", "সেতু", "গ্রহ", "নদী", "বাগান", "জানালা", "পাহাড়", "সমুদ্র", "মোমবাতি", "পকেট",
    "রূপা", "আম", "বজ্র", "দুর্গ", "পেনসিল", "আয়না", "বন", "দ্বীপ", "রকেট", "পালক",
    "হাতুড়ি", "জ্যাকেট", "লেবু", "খরগোশ", "বাঘ", "ছাতা", "মেঘ", "ফুল", "গিটার", "বাজার",
    "পিয়ানো", "রংধনু", "আপেল", "ক্যামেরা", "মধু", "লণ্ঠন",
  ],
  ta: [
    "நண்பன்", "பாலம்", "கிரகம்", "ஆறு", "தோட்டம்", "ஜன்னல்", "மலை", "கடல்", "மெழுகுவர்த்தி", "பை",
    "வெள்ளி", "மாம்பழம்", "இடி", "கோட்டை", "பென்சில்", "கண்ணாடி", "காடு", "தீவு", "ராக்கெட்", "இறகு",
    "சுத்தியல்", "ஜாக்கெட்", "எலுமிச்சை", "முயல்", "புலி", "குடை", "மேகம்", "பூ", "கிட்டார்", "சந்தை",
    "பியானோ", "வானவில்", "ஆப்பிள்", "கேமரா", "தேன்", "விளக்கு",
  ],
  te: [
    "స్నేహితుడు", "వంతెన", "గ్రహం", "నది", "తోట", "కిటికీ", "కొండ", "సముద్రం", "కొవ్వొత్తి", "జేబు",
    "వెండి", "మామిడి", "ఉరుము", "కోట", "పెన్సిల్", "అద్దం", "అడవి", "ద్వీపం", "రాకెట్", "ఈక",
    "సుత్తి", "జాకెట్", "నిమ్మ", "కుందేలు", "పులి", "గొడుగు", "మేఘం", "పువ్వు", "గిటార్", "మార్కెట్",
    "పియానో", "ఇంద్రధనుస్సు", "ఆపిల్", "కెమెరా", "తేనె", "లాంతరు",
  ],
  kn: [
    "ಸ್ನೇಹಿತ", "ಸೇತುವೆ", "ಗ್ರಹ", "ನದಿ", "ತೋಟ", "ಕಿಟಕಿ", "ಪರ್ವತ", "ಸಮುದ್ರ", "ಮೇಣದಬತ್ತಿ", "ಜೇಬು",
    "ಬೆಳ್ಳಿ", "ಮಾವು", "ಗುಡುಗು", "ಕೋಟೆ", "ಪೆನ್ಸಿಲ್", "ಕನ್ನಡಿ", "ಕಾಡು", "ದ್ವೀಪ", "ರಾಕೆಟ್", "ಗರಿ",
    "ಸುತ್ತಿಗೆ", "ಜಾಕೆಟ್", "ನಿಂಬೆ", "ಮೊಲ", "ಹುಲಿ", "ಛತ್ರಿ", "ಮೋಡ", "ಹೂವು", "ಗಿಟಾರ್", "ಮಾರುಕಟ್ಟೆ",
    "ಪಿಯಾನೋ", "ಕಾಮನಬಿಲ್ಲು", "ಸೇಬು", "ಕ್ಯಾಮೆರಾ", "ಜೇನು", "ಲ್ಯಾಂಟರ್ನ್",
  ],
  ar: [
    "صديق", "جسر", "كوكب", "نهر", "حديقة", "نافذة", "جبل", "محيط", "شمعة", "جيب",
    "فضة", "مانجو", "رعد", "قلعة", "قلم", "مرآة", "غابة", "جزيرة", "صاروخ", "ريشة",
    "مطرقة", "سترة", "ليمون", "أرنب", "نمر", "مظلة", "سحابة", "زهرة", "غيتار", "سوق",
    "بيانو", "قوس قزح", "تفاحة", "كاميرا", "عسل", "فانوس",
  ],
  he: [
    "חבר", "גשר", "כוכב לכת", "נהר", "גן", "חלון", "הר", "אוקיינוס", "נר", "כיס",
    "כסף", "מנגו", "רעם", "טירה", "עיפרון", "מראה", "יער", "אי", "רקטה", "נוצה",
    "פטיש", "ז'קט", "לימון", "ארנב", "נמר", "מטרייה", "ענן", "פרח", "גיטרה", "שוק",
    "פסנתר", "קשת", "תפוח", "מצלמה", "דבש", "פנס",
  ],
  ja: [
    "友達", "橋", "惑星", "川", "庭", "窓", "山", "海", "ろうそく", "ポケット",
    "銀", "マンゴー", "雷", "城", "鉛筆", "鏡", "森", "島", "ロケット", "羽",
    "ハンマー", "ジャケット", "レモン", "うさぎ", "虎", "傘", "雲", "花", "ギター", "市場",
    "ピアノ", "虹", "りんご", "カメラ", "はちみつ", "ランタン",
  ],
  ko: [
    "친구", "다리", "행성", "강", "정원", "창문", "산", "바다", "촛불", "주머니",
    "은", "망고", "천둥", "성", "연필", "거울", "숲", "섬", "로켓", "깃털",
    "망치", "재킷", "레몬", "토끼", "호랑이", "우산", "구름", "꽃", "기타", "시장",
    "피아노", "무지개", "사과", "카메라", "꿀", "랜턴",
  ],
  zh: [
    "朋友", "桥", "行星", "河", "花园", "窗户", "山", "大海", "蜡烛", "口袋",
    "银", "芒果", "雷", "城堡", "铅笔", "镜子", "森林", "岛", "火箭", "羽毛",
    "锤子", "夹克", "柠檬", "兔子", "老虎", "雨伞", "云", "花", "吉他", "市场",
    "钢琴", "彩虹", "苹果", "相机", "蜂蜜", "灯笼",
  ],
  th: [
    "เพื่อน", "สะพาน", "ดาวเคราะห์", "แม่น้ำ", "สวน", "หน้าต่าง", "ภูเขา", "มหาสมุทร", "เทียน", "กระเป๋า",
    "เงิน", "มะม่วง", "ฟ้าร้อง", "ปราสาท", "ดินสอ", "กระจก", "ป่า", "เกาะ", "จรวด", "ขนนก",
    "ค้อน", "แจ็กเก็ต", "มะนาว", "กระต่าย", "เสือ", "ร่ม", "เมฆ", "ดอกไม้", "กีตาร์", "ตลาด",
    "เปียโน", "สายรุ้ง", "แอปเปิ้ล", "กล้อง", "น้ำผึ้ง", "โคมไฟ",
  ],
};

export function startWordPack(language: string): readonly string[] {
  return PACKS[language] ?? PACKS.en;
}

export function pickStartWord(language: string, seed: number): { word: string; english: Word } {
  const english = ENGLISH_START_WORDS[Math.abs(seed) % ENGLISH_START_WORDS.length];
  const pack = startWordPack(language);
  const index = ENGLISH_START_WORDS.indexOf(english);
  return { word: pack[index] ?? english, english };
}

export function missingStartWordMessage(word: string, languageName: string): string {
  return `We didn't hear “${word}” at the start, so nothing was saved. Say “${word}” first, in ${languageName}, then your answer, and record again.`;
}

export function everyLanguageHasStartWords(): boolean {
  return LANGUAGES.every((language) => startWordPack(language.code).length === ENGLISH_START_WORDS.length);
}
