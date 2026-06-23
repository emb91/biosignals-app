# Arcova logo

The Arcova mark is **five equal-width bars tracing a soft triangle** — flat
bottoms, rounded fading tops. It reads as an "A" / an aurora of signal without
being a literal letter. The primary brand expression is the **teal-to-pink**
gradient, and the favourite application is that mark on the **brand navy**.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| Navy | `#003344` | Icon background, dark surfaces |
| Ink | `#0d3547` | Wordmark on light |
| Teal | `#00a4b4` | Primary brand teal (gradient base) |
| Teal-deep | `#006c79` | Gradient base shadow |
| Mint | `#8cd9c9` | Gradient mid |
| Pale pink | `#f6cdda` | Gradient tip (teal-to-pink only) |
| Lilac | `#d8c6e6` | Bridge between teal and pink (avoids a muddy middle) |

**Gradients**
- *Teal-to-pink* — one wash across all five bars, diagonal `#00a4b4 → #7fd8cd → #d8c6e6 → #f6cdda` (`userSpaceOnUse`, so it spans the whole mark, not each bar).
- *Teal* — per-bar vertical `#006c79 → #00a4b4 → #2bbfb8 → #7adfd2 → pale`.

## Wordmark

The wordmark is **"arcova" in Quicksand, weight 500**, lowercase, letter-spacing
`-0.01em`. Tone is Ink on light, White on dark. In the lockup the mark sits close
to the word (small gap).

## Files

`branding/logo/` (source — edit here):

| File | What |
| --- | --- |
| `mark-teal-pink.svg` | Primary mark, transparent bg |
| `mark-teal.svg` | Teal-only mark, transparent bg |
| `mark-white.svg` / `mark-navy.svg` | One-colour marks |
| `icon-pink-navy.svg` | **Primary app icon** (favourite) |
| `icon-pink-white.svg` | Teal-to-pink on white |
| `icon-teal-navy.svg` / `icon-teal-white.svg` | Teal variants |
| `generate-assets.mjs` | Rasterises the PNG/favicon set into `public/brand/` |

`public/brand/` (generated + served — do not hand-edit the PNGs):
`favicon.svg`, `favicon-16/32/48.png`, `apple-touch-icon.png`,
`icon-192/512/1024.png`, plus a `.png` of each variant for slides/handoff, and
copies of every source SVG.

## Using it in the app

```tsx
import { ArcovaMark } from "@/components/brand/ArcovaMark"
import { ArcovaLogo } from "@/components/brand/ArcovaLogo"

<ArcovaMark variant="teal-pink" size={32} />        // bars only
<ArcovaLogo variant="teal-pink" tone="ink" />        // mark + "arcova"
<ArcovaLogo variant="teal-pink" tone="light" />      // on a dark background
```

`variant`: `teal-pink` (default) · `teal` · `white` · `navy`.

The favicon / app icons are wired in `app/layout.tsx` (`metadata.icons`) to the
`/brand/*` files.

## Regenerating PNGs

After editing any source SVG:

```bash
node branding/logo/generate-assets.mjs
```

(Uses `sharp`, already a dependency.)

## Clear space & minimum size

- Keep clear space around the mark equal to the width of one bar.
- Minimum mark size: 20px (web), 16px favicon is generated but prefer 24px+ in UI.
- The app icon already has built-in padding — don't add the squircle around the bare mark a second time.

## Don'ts

- Don't recolour the bars outside the palette, or swap the gradient direction.
- Don't add the old concentric-ring / orb treatment.
- Don't stretch, rotate, or add a drop shadow to the mark.
- Don't set the wordmark in a heavy weight — Quicksand 500 (finer) is the look.
- Don't put the teal-on-white mark on a busy/coloured photo; use white or navy mono there.
