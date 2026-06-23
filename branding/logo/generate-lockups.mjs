// Builds the horizontal Arcova lockups: the curtain mark + "arcova" wordmark,
// with the wordmark OUTLINED from Quicksand 500 (so the files are self-contained,
// no font dependency). Run from repo root:
//   node branding/logo/generate-lockups.mjs
// Prereqs: opentype.js (npm i --no-save opentype.js) and the Quicksand variable
// TTF cached in branding/logo/.fonttmp (auto-downloaded here if missing).

import fs from "node:fs"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import opentype from "opentype.js"
import sharp from "sharp"

const here = dirname(fileURLToPath(import.meta.url))
const served = join(here, "../../public/brand")
const dests = [served, here]
const fontPath = join(here, ".fonttmp/Quicksand-var.ttf")

if (!fs.existsSync(fontPath)) {
  await mkdir(dirname(fontPath), { recursive: true })
  const res = await fetch("https://raw.githubusercontent.com/google/fonts/main/ofl/quicksand/Quicksand%5Bwght%5D.ttf")
  await writeFile(fontPath, Buffer.from(await res.arrayBuffer()))
}

const font = opentype.parse((await readFile(fontPath)).buffer)
font.variation.set({ wght: 500 }) // the weight we picked

// --- mark geometry (native bar coords) ---
const BARS = [
  "M16.5 94L16.5 73.5A7.5 7.5 0 0 1 31.5 73.5L31.5 94A4 4 0 0 1 27.5 98L20.5 98A4 4 0 0 1 16.5 94Z",
  "M34.5 94L34.5 51.5A7.5 7.5 0 0 1 49.5 51.5L49.5 94A4 4 0 0 1 45.5 98L38.5 98A4 4 0 0 1 34.5 94Z",
  "M52.5 94L52.5 39.5A7.5 7.5 0 0 1 67.5 39.5L67.5 94A4 4 0 0 1 63.5 98L56.5 98A4 4 0 0 1 52.5 94Z",
  "M70.5 94L70.5 51.5A7.5 7.5 0 0 1 85.5 51.5L85.5 94A4 4 0 0 1 81.5 98L74.5 98A4 4 0 0 1 70.5 94Z",
  "M88.5 94L88.5 73.5A7.5 7.5 0 0 1 103.5 73.5L103.5 94A4 4 0 0 1 99.5 98L92.5 98A4 4 0 0 1 88.5 94Z",
]
const MARK = { x1: 16.5, y1: 32, x2: 103.5, y2: 98 }
const MARK_CY = (MARK.y1 + MARK.y2) / 2 // 65

const PINK = `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="20" y1="98" x2="100" y2="28"><stop offset="0" stop-color="#00a4b4"/><stop offset="0.44" stop-color="#7fd8cd"/><stop offset="0.76" stop-color="#d8c6e6"/><stop offset="1" stop-color="#f6cdda"/></linearGradient>`
const TEAL = `<linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#006c79"/><stop offset="0.32" stop-color="#00a4b4"/><stop offset="0.62" stop-color="#2bbfb8"/><stop offset="0.84" stop-color="#7adfd2"/><stop offset="1" stop-color="#d6f7ef" stop-opacity="0.25"/></linearGradient>`

// --- wordmark (outlined) ---
const FONT_SIZE = 74
const GAP = 18
const wm = font.getPath("arcova", 0, 0, FONT_SIZE) // baseline at y=0
const wb = wm.getBoundingBox()
const tx = MARK.x2 + GAP - wb.x1
const ty = MARK_CY - (wb.y1 + wb.y2) / 2
const wordPath = wm.toPathData(2)

const wordL = wb.x1 + tx, wordR = wb.x2 + tx, wordT = wb.y1 + ty, wordB = wb.y2 + ty
const PAD = 6
const ux1 = Math.min(MARK.x1, wordL) - PAD
const uy1 = Math.min(MARK.y1, wordT) - PAD
const ux2 = Math.max(MARK.x2, wordR) + PAD
const uy2 = Math.max(MARK.y2, wordB) + PAD
const vw = +(ux2 - ux1).toFixed(2)
const vh = +(uy2 - uy1).toFixed(2)
const viewBox = `${ux1.toFixed(2)} ${uy1.toFixed(2)} ${vw} ${vh}`

function lockup({ grad, word }) {
  const bars = BARS.map((d) => `<path d="${d}"/>`).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${Math.round(vw * 2)}" height="${Math.round(vh * 2)}" fill="none" role="img" aria-label="Arcova">
  <defs>${grad}</defs>
  <g fill="url(#g)">${bars}</g>
  <path transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)})" d="${wordPath}" fill="${word}"/>
</svg>
`
}

const FILES = {
  "lockup-teal-pink.svg": lockup({ grad: PINK, word: "#0d3547" }),
  "lockup-teal-pink-white.svg": lockup({ grad: PINK, word: "#ffffff" }),
  "lockup-teal.svg": lockup({ grad: TEAL, word: "#0d3547" }),
}

await mkdir(served, { recursive: true })
for (const [name, svg] of Object.entries(FILES)) {
  for (const d of dests) await writeFile(join(d, name), svg)
  console.log("svg  ", name)
  const png = await sharp(Buffer.from(svg), { density: 600 }).resize({ width: 1200 }).png().toBuffer()
  for (const d of dests) await writeFile(join(d, name.replace(".svg", ".png")), png)
  console.log("png  ", name.replace(".svg", ".png"))
}
console.log("done -> public/brand + branding/logo")
