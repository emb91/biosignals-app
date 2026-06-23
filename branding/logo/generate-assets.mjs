// Rasterizes the Arcova logo SVGs into the PNG sizes the web + app need.
// Run from the repo root:  node branding/logo/generate-assets.mjs
// Rendered assets are written to BOTH public/brand/ (served) and this
// branding/logo/ folder (master copy). Requires `sharp` (already a dependency).

import sharp from "sharp"
import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const served = join(here, "../../public/brand")
const dests = [served, here] // rendered assets land in both places
await mkdir(served, { recursive: true })

async function emit(name, buf) {
  for (const d of dests) await writeFile(join(d, name), buf)
  console.log("png  ", name)
}

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
  await emit(name, await sharp(primary, { density: 512 }).resize(size, size).png().toBuffer())
}

// white-squircle favicon set (mark on white tile)
const whiteSquircle = await readFile(join(here, "icon-pink-white.svg"))
for (const size of [16, 32, 48]) {
  await emit(`favicon-white-${size}.png`, await sharp(whiteSquircle, { density: 512 }).resize(size, size).png().toBuffer())
}

// a 512 PNG of each squircle variant for handoff / slides
for (const variant of ["icon-pink-navy", "icon-pink-white", "icon-teal-navy", "icon-teal-white"]) {
  await emit(`${variant}.png`, await sharp(await readFile(join(here, `${variant}.svg`)), { density: 512 }).resize(512, 512).png().toBuffer())
}

// transparent "no background" favicons, square-cropped from the bare curtains
for (const base of ["favicon-curtain", "favicon-curtain-teal"]) {
  const svg = await readFile(join(here, `${base}.svg`))
  for (const size of [16, 32, 48]) {
    await emit(`${base}-${size}.png`, await sharp(svg, { density: 600 }).resize(size, size).png().toBuffer())
  }
}

// transparent PNG exports of the bare curtain marks (no background)
for (const m of ["mark-teal", "mark-teal-pink"]) {
  for (const w of [512, 1024]) {
    await emit(`${m}-${w}.png`, await sharp(await readFile(join(here, `${m}.svg`)), { density: 600 }).resize({ width: w }).png().toBuffer())
  }
}

// favicon.svg = the primary icon, in both folders
for (const d of dests) await copyFile(join(here, "icon-pink-navy.svg"), join(d, "favicon.svg"))
console.log("svg   favicon.svg")

// copy every source SVG into public/brand so the site can serve them
for (const f of await readdir(here)) {
  if (f.endsWith(".svg")) await copyFile(join(here, f), join(served, f))
}
console.log("copied source SVGs to public/brand")
console.log("done -> public/brand + branding/logo")
