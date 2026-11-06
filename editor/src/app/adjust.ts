// Photo adjustments in the spirit of the "Anpassen" panel of Apple Photos. All work on
// RGBA pixel data (0–255) so they run the same in the app and in tests.

export interface Adjustments {
  /** Stops, -2…2 */
  belichtung: number;
  /** -100…100, mid-tones */
  helligkeit: number;
  /** -100…100, recovers (−) or lifts (+) bright areas */
  lichter: number;
  /** -100…100, lifts (+) or deepens (−) dark areas */
  schatten: number;
  /** -100…100 */
  kontrast: number;
  /** 0…100 */
  schwarzpunkt: number;
  /** -100…100 */
  saettigung: number;
  /** -100…100, blue ↔ yellow */
  waerme: number;
  /** -100…100, green ↔ magenta */
  farbton: number;
  /** 0…100 */
  schaerfe: number;
}

export const NEUTRAL: Adjustments = {
  belichtung: 0, helligkeit: 0, lichter: 0, schatten: 0, kontrast: 0, schwarzpunkt: 0,
  saettigung: 0, waerme: 0, farbton: 0, schaerfe: 0,
};

export const isNeutral = (a: Adjustments) =>
  (Object.keys(NEUTRAL) as (keyof Adjustments)[]).every((k) => a[k] === NEUTRAL[k]);

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Applies all adjustments in place. */
export function applyAdjustments(img: ImageData, a: Adjustments): void {
  const d = img.data;
  const exp = Math.pow(2, a.belichtung);
  const gamma = Math.pow(2, -a.helligkeit / 100); // < 1 brightens mid-tones
  const k = 1 + a.kontrast / 100;
  const bp = (a.schwarzpunkt / 100) * 0.25;
  const sat = 1 + a.saettigung / 100;
  const warm = (a.waerme / 100) * 0.12;
  const tint = (a.farbton / 100) * 0.1;
  const hi = a.lichter / 100;
  const sh = a.schatten / 100;

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i]! / 255;
    let g = d[i + 1]! / 255;
    let b = d[i + 2]! / 255;

    // White balance first, like a camera would.
    r *= 1 + warm; b *= 1 - warm; g *= 1 - tint;
    r *= exp; g *= exp; b *= exp;

    // Highlights and shadows: scale by a luminance mask so colours keep their ratios.
    let l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (hi !== 0 || sh !== 0) {
      const lc = clamp01(l);
      const target =
        lc + hi * smooth(0.45, 1, lc) * (hi < 0 ? lc - 0.45 : 1 - lc) * 0.9 +
        sh * smooth(0.55, 0, lc) * (sh > 0 ? 0.55 - lc : lc) * 0.9;
      const f = l > 1e-4 ? target / l : 1;
      r *= f; g *= f; b *= f;
    }

    // Black point, brightness (gamma), contrast around the middle.
    r = Math.pow(clamp01((r - bp) / (1 - bp)), gamma);
    g = Math.pow(clamp01((g - bp) / (1 - bp)), gamma);
    b = Math.pow(clamp01((b - bp) / (1 - bp)), gamma);
    if (k !== 1) { r = (r - 0.5) * k + 0.5; g = (g - 0.5) * k + 0.5; b = (b - 0.5) * k + 0.5; }

    if (sat !== 1) {
      l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
    }
    d[i] = clamp01(r) * 255 + 0.5;
    d[i + 1] = clamp01(g) * 255 + 0.5;
    d[i + 2] = clamp01(b) * 255 + 0.5;
  }
  if (a.schaerfe > 0) sharpen(img, a.schaerfe / 100);
}

/** Unsharp mask with a 3×3 blur; `amount` 0…1. */
export function sharpen(img: ImageData, amount: number): void {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const s = amount * 1.6;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const j = i + c;
        const blur = (
          src[j - 4 * w - 4]! + 2 * src[j - 4 * w]! + src[j - 4 * w + 4]! +
          2 * src[j - 4]! + 4 * src[j]! + 2 * src[j + 4]! +
          src[j + 4 * w - 4]! + 2 * src[j + 4 * w]! + src[j + 4 * w + 4]!
        ) / 16;
        d[j] = src[j]! + s * (src[j]! - blur);
      }
    }
  }
}

/**
 * "Automatisch": sets exposure, black point and a little contrast and saturation from the
 * picture's brightness distribution.
 */
export function autoAdjust(img: ImageData): Adjustments {
  const d = img.data;
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < d.length; i += 16) {
    hist[Math.round(0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!)]!++;
    n++;
  }
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]!; if (acc >= n * p) return v / 255; }
    return 1;
  };
  const low = pct(0.005), mid = pct(0.5), high = pct(0.995);
  const belichtung = Math.max(-1, Math.min(1, Math.log2(0.98 / Math.max(high, 0.2))));
  const schwarzpunkt = Math.max(0, Math.min(20, Math.round(low * 200)));
  const helligkeit = Math.max(-40, Math.min(40, Math.round((0.45 - mid * Math.pow(2, belichtung)) * 120)));
  return {
    ...NEUTRAL,
    belichtung: Math.round(belichtung * 100) / 100,
    schwarzpunkt,
    helligkeit,
    kontrast: 8,
    saettigung: 10,
    schaerfe: 15,
  };
}
