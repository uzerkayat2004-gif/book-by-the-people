/** Live-Studio style relative age for a backup row. */
export function backupAge(createdAt: Date, now = Date.now()): string {
  const minutes = Math.floor((now - createdAt.getTime()) / 60_000);
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}
