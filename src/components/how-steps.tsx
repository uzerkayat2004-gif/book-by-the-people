"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * "Your voice. A real book." — the three numbered steps from the first Book by the People site
 * (crowdbook prototype v7): red icon dots joined by a filling line, outlined 01/02/03, big titles.
 * Rendered visible on the server; on the client it replays the reveal when scrolled into view.
 */
export function HowSteps({ steps }: { steps: { icon: ReactNode; title: string; copy: string }[] }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = node.getBoundingClientRect();
    if (box.top < window.innerHeight * 0.85) return;
    node.classList.remove("in");
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        node.classList.add("in");
        observer.disconnect();
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <section ref={ref} className="wrap how7 in" id="how" data-testid="how">
      <h2 className="how7__h">
        Your voice.
        <br />
        <span className="red">A real book.</span>
      </h2>
      <ol className="how7__steps">
        <span className="how7__line" aria-hidden="true">
          <i />
          <em />
        </span>
        {steps.map((step, index) => (
          <li className="how7__s" style={{ ["--i" as string]: index }} key={step.title}>
            <span className="how7__ic">{step.icon}</span>
            <span className="how7__n" aria-hidden="true">
              0{index + 1}
            </span>
            <b className="how7__t">{step.title}</b>
            <p>{step.copy}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
