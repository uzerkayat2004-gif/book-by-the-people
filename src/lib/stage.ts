export type Stage = "before" | "closed" | "after";

export function stageFor(status: string, override?: string | null): Stage {
  if (override === "before" || override === "closed" || override === "after") return override;
  if (status === "PUBLISHED") return "after";
  if (status === "COLLECTING") return "before";
  return "closed";
}

export function releaseLabel(date: Date | null): string {
  if (!date) return "the close";
  const formatted = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date);
  return `${formatted.replace(", ", " · ")} IST`;
}

const SHORT: Record<string, string> = {
  US: "USA",
  GB: "UK",
  AE: "UAE",
};

export function shortCountry(code: string, name: string) {
  return SHORT[code] ?? name;
}
