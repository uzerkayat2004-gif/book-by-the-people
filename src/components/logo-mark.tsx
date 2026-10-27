/* eslint-disable @next/next/no-img-element */
// The only logo: the small round icon (same art as the favicon).
export function LogoMark({ className = "logo__mark" }: { className?: string }) {
  return <img className={className} src="/apple-touch-icon.png" alt="" aria-hidden="true" width={26} height={26} />;
}
