/**
 * Motion timings for the `motion` library, in SECONDS. These mirror the CSS motion tokens in styles/tokens.css
 * (--duration-*, --stagger-step, --ease-*, --rise-distance); tests/frontend/tokens.test.ts fails if they drift apart.
 * Change timings in tokens.css first, then here.
 */
export const duration = { fast: 0.15, base: 0.22, slow: 0.35, data: 0.7 } as const;
export const staggerStep = 0.05;
export const ease = { out: [0.22, 1, 0.36, 1], inOut: [0.65, 0, 0.35, 1] } as const;
/** How far (px) content rises while fading in. Dropped to 0 automatically when the person asks for reduced motion. */
export const riseDistance = 8;
