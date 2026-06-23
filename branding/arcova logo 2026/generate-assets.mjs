// Rasterizes the Arcova logo SVGs into the PNG sizes the web + app need.
// Run from the repo root:  node branding/logo/generate-assets.mjs
// Outputs into public/brand/. Requires `sharp` (already a dependency).

import sharp from "sharp"
import { readFile, mkdir, copyFile, readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, "../../public/brand")
await mkdir(out, { recursive: true })

// favicon + app-icon PNGs are cut from the primary mark: teal-to-pink on navy
const primary = await readFile(join(here, "icon-pink-navy.svg"))
const sizes = {
  "favicon-16.png": 16,
  "favicon-32.png": 32,
  "favicon-48.png": 48,
  "apple-touch-icon.png": 180,
  "icon-192.png": 192,
  "icon-512.png": 512,
  "icon-1024.png": 1024,
}
for (const [name, size] of Object.entries(sizes)) {
  await sharp(primary, { density: 512 }).resize(size, size).png().toFile(join(out, name))
  console.log("png  ", name, `${size}px`)
}

// also render a PNG of each variant at 512 for handoff / slides
for (const variant of ["icon-pink-navy", "icon-pink-white", "icon-teal-navy", "icon-teal-white"]) {
  await sharp(await readFile(join(here, `${variant}.svg`)), { density: 512 }).resize(512, 512).png().toFile(join(out, `${variant}.png`))
  console.log("png  ", `${variant}.png`)
}

// transparent PNG exports of the bare curtain marks (no background)
for (const m of ["mark-teal", "mark-teal-pink"]) {
  const buf = await readFile(join(here, `${m}.svg`))
  for (const w of [512, 1024]) {
    await sharp(buf, { density: 600 }).resize({ width: w }).png().toFile(join(out, `${m}-${w}.png`))
    console.log("png  ", `${m}-${w}.png`)
  }
}

// copy every source SVG into public/brand so the site can serve them
for (const f of await readdir(here)) {
  if (f.endsWith(".svg")) await copyFile(join(here, f), join(out, f))
}
// favicon.svg = the primary icon
await copyFile(join(here, "icon-pink-navy.svg"), join(out, "favicon.svg"))
console.log("copied source SVGs + favicon.svg")
console.log("done ->", out)
