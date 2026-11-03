export type Country = { code: string; name: string; lat: number; lng: number };

export const COUNTRIES: Country[] = [
  { code: "AR", name: "Argentina", lat: -38.4, lng: -63.6 },
  { code: "AU", name: "Australia", lat: -25.3, lng: 133.8 },
  { code: "AT", name: "Austria", lat: 47.5, lng: 14.6 },
  { code: "BD", name: "Bangladesh", lat: 23.7, lng: 90.4 },
  { code: "BE", name: "Belgium", lat: 50.5, lng: 4.5 },
  { code: "BR", name: "Brazil", lat: -14.2, lng: -51.9 },
  { code: "BG", name: "Bulgaria", lat: 42.7, lng: 25.5 },
  { code: "CA", name: "Canada", lat: 56.1, lng: -106.3 },
  { code: "CL", name: "Chile", lat: -35.7, lng: -71.5 },
  { code: "CN", name: "China", lat: 35.9, lng: 104.2 },
  { code: "CO", name: "Colombia", lat: 4.6, lng: -74.3 },
  { code: "CZ", name: "Czechia", lat: 49.8, lng: 15.5 },
  { code: "DK", name: "Denmark", lat: 56.3, lng: 9.5 },
  { code: "EG", name: "Egypt", lat: 26.8, lng: 30.8 },
  { code: "ET", name: "Ethiopia", lat: 9.1, lng: 40.5 },
  { code: "FI", name: "Finland", lat: 61.9, lng: 25.7 },
  { code: "FR", name: "France", lat: 46.2, lng: 2.2 },
  { code: "DE", name: "Germany", lat: 51.2, lng: 10.4 },
  { code: "GH", name: "Ghana", lat: 7.9, lng: -1 },
  { code: "GR", name: "Greece", lat: 39.1, lng: 21.8 },
  { code: "HU", name: "Hungary", lat: 47.2, lng: 19.5 },
  { code: "IN", name: "India", lat: 22.8, lng: 79 },
  { code: "ID", name: "Indonesia", lat: -0.8, lng: 113.9 },
  { code: "IE", name: "Ireland", lat: 53.1, lng: -8 },
  { code: "IL", name: "Israel", lat: 31, lng: 34.9 },
  { code: "IT", name: "Italy", lat: 41.9, lng: 12.6 },
  { code: "JP", name: "Japan", lat: 36.2, lng: 138.3 },
  { code: "KE", name: "Kenya", lat: 0.02, lng: 37.9 },
  { code: "MY", name: "Malaysia", lat: 4.2, lng: 101.98 },
  { code: "MX", name: "Mexico", lat: 23.6, lng: -102.5 },
  { code: "MA", name: "Morocco", lat: 31.8, lng: -7.1 },
  { code: "NP", name: "Nepal", lat: 28.4, lng: 84.1 },
  { code: "NL", name: "Netherlands", lat: 52.1, lng: 5.3 },
  { code: "NZ", name: "New Zealand", lat: -40.9, lng: 174.9 },
  { code: "NG", name: "Nigeria", lat: 9.1, lng: 8.7 },
  { code: "NO", name: "Norway", lat: 60.5, lng: 8.5 },
  { code: "PK", name: "Pakistan", lat: 30.4, lng: 69.3 },
  { code: "PE", name: "Peru", lat: -9.2, lng: -75 },
  { code: "PH", name: "Philippines", lat: 12.9, lng: 121.8 },
  { code: "PL", name: "Poland", lat: 51.9, lng: 19.1 },
  { code: "PT", name: "Portugal", lat: 39.4, lng: -8.2 },
  { code: "RO", name: "Romania", lat: 45.9, lng: 24.97 },
  { code: "SA", name: "Saudi Arabia", lat: 23.9, lng: 45.1 },
  { code: "SG", name: "Singapore", lat: 1.35, lng: 103.8 },
  { code: "ZA", name: "South Africa", lat: -30.6, lng: 22.9 },
  { code: "KR", name: "South Korea", lat: 35.9, lng: 127.8 },
  { code: "ES", name: "Spain", lat: 40.5, lng: -3.7 },
  { code: "LK", name: "Sri Lanka", lat: 7.9, lng: 80.8 },
  { code: "SE", name: "Sweden", lat: 60.1, lng: 18.6 },
  { code: "CH", name: "Switzerland", lat: 46.8, lng: 8.2 },
  { code: "TZ", name: "Tanzania", lat: -6.4, lng: 34.9 },
  { code: "TH", name: "Thailand", lat: 15.9, lng: 100.9 },
  { code: "TR", name: "Turkey", lat: 38.96, lng: 35.2 },
  { code: "UA", name: "Ukraine", lat: 48.4, lng: 31.2 },
  { code: "AE", name: "United Arab Emirates", lat: 23.4, lng: 53.8 },
  { code: "GB", name: "United Kingdom", lat: 55.4, lng: -3.4 },
  { code: "US", name: "United States", lat: 37.1, lng: -95.7 },
  { code: "VN", name: "Vietnam", lat: 14.1, lng: 108.3 },
];

export function countryByCode(code: string | null | undefined): Country | null {
  if (!code) return null;
  return COUNTRIES.find((country) => country.code === code) ?? null;
}

export function flagEmoji(code: string): string {
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "";
  return [...upper].map((character) => String.fromCodePoint(127397 + character.charCodeAt(0))).join("");
}

export function countryStats(
  voices: { countryCode: string | null }[],
): { code: string; name: string; count: number; lat: number; lng: number }[] {
  const counts = new Map<string, number>();
  for (const voice of voices) {
    if (!voice.countryCode) continue;
    counts.set(voice.countryCode, (counts.get(voice.countryCode) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => {
      const country = countryByCode(code);
      return {
        code,
        name: country?.name ?? code,
        count,
        lat: country?.lat ?? 0,
        lng: country?.lng ?? 0,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
