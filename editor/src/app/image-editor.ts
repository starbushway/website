import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, input, output, signal, viewChild } from '@angular/core';
import { Adjustments, NEUTRAL, applyAdjustments, autoAdjust, isNeutral } from './adjust';

interface Crop { x: number; y: number; w: number; h: number } // 0…1 of the straightened picture
type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

interface Slider { key: keyof Adjustments; label: string; min: number; max: number; step: number }

const LICHT: Slider[] = [
  { key: 'belichtung', label: 'Belichtung', min: -2, max: 2, step: 0.05 },
  { key: 'helligkeit', label: 'Helligkeit', min: -100, max: 100, step: 1 },
  { key: 'lichter', label: 'Lichter', min: -100, max: 100, step: 1 },
  { key: 'schatten', label: 'Schatten', min: -100, max: 100, step: 1 },
  { key: 'kontrast', label: 'Kontrast', min: -100, max: 100, step: 1 },
  { key: 'schwarzpunkt', label: 'Schwarzpunkt', min: 0, max: 100, step: 1 },
];
const FARBE: Slider[] = [
  { key: 'saettigung', label: 'Sättigung', min: -100, max: 100, step: 1 },
  { key: 'waerme', label: 'Wärme', min: -100, max: 100, step: 1 },
  { key: 'farbton', label: 'Farbton', min: -100, max: 100, step: 1 },
];
const SCHAERFE: Slider[] = [{ key: 'schaerfe', label: 'Schärfe', min: 0, max: 100, step: 1 }];

const RATIOS: { label: string; value: number | 'original' | null }[] = [
  { label: 'Frei', value: null },
  { label: 'Original', value: 'original' },
  { label: 'Quadrat', value: 1 },
  { label: '4 : 3', value: 4 / 3 },
  { label: '3 : 4', value: 3 / 4 },
  { label: '16 : 9', value: 16 / 9 },
];

const PREVIEW_MAX = 1100;
const OUTPUT_MAX = 1600;

/** Full-screen photo editor: crop and straighten, light, colour, sharpness. */
@Component({
  selector: 'app-image-editor',
  template: `
    <div class="bildbearbeitung" role="dialog" aria-modal="true" aria-label="Foto bearbeiten">
      <div class="bb-bild" #stage>
        <canvas #canvas [style.left.px]="view().x" [style.top.px]="view().y"
                [style.width.px]="view().w" [style.height.px]="view().h"></canvas>
        @if (tab() === 'zuschneiden') {
          <div class="bb-rahmen"
               [style.left.px]="view().x + crop().x * view().w"
               [style.top.px]="view().y + crop().y * view().h"
               [style.width.px]="crop().w * view().w"
               [style.height.px]="crop().h * view().h"
               (pointerdown)="startDrag($event, 'move')">
            <div class="bb-raster"></div>
            @for (h of handles; track h) {
              <div class="bb-griff bb-{{ h }}" (pointerdown)="startDrag($event, h)"></div>
            }
          </div>
        }
        @if (comparing()) { <div class="bb-hinweis">Original</div> }
      </div>

      <aside class="bb-leiste">
        <div class="ansicht-wahl bb-tabs" role="tablist">
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'anpassen'" (click)="tab.set('anpassen'); redraw()">Anpassen</button>
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'zuschneiden'" (click)="tab.set('zuschneiden'); redraw()">Zuschneiden</button>
        </div>

        @if (tab() === 'anpassen') {
          <div class="bb-knopfzeile">
            <button type="button" class="neben" (click)="auto()">✨ Automatisch</button>
            <button type="button" class="neben" (pointerdown)="compare(true)" (pointerup)="compare(false)"
                    (pointerleave)="compare(false)" title="Gedrückt halten">Vorher zeigen</button>
          </div>
          @for (group of groups; track group.title) {
            <h3>{{ group.title }}</h3>
            @for (s of group.sliders; track s.key) {
              <label class="bb-regler" (dblclick)="set(s.key, 0)" title="Doppelklick: zurücksetzen">
                <span>{{ s.label }} <output>{{ format(s) }}</output></span>
                <input type="range" [min]="s.min" [max]="s.max" [step]="s.step" [value]="adj()[s.key]"
                       (input)="set(s.key, +$any($event.target).value)" />
              </label>
            }
          }
        } @else {
          <h3>Seitenverhältnis</h3>
          <div class="bb-wahl">
            @for (r of ratios; track r.label) {
              <button type="button" [class.aktiv]="ratioLabel() === r.label" (click)="setRatio(r.label)">{{ r.label }}</button>
            }
          </div>
          <h3>Drehen</h3>
          <div class="bb-wahl">
            <button type="button" (click)="rotate(-1)">⟲ Links</button>
            <button type="button" (click)="rotate(1)">⟳ Rechts</button>
            <button type="button" (click)="flip.set(!flip()); rebuild()">⇋ Spiegeln</button>
          </div>
          <label class="bb-regler" (dblclick)="setStraighten(0)">
            <span>Ausrichten <output>{{ straighten() }}°</output></span>
            <input type="range" min="-15" max="15" step="0.5" [value]="straighten()"
                   (input)="setStraighten(+$any($event.target).value)" />
          </label>
          <p class="hilfe">Ziehen Sie am Rahmen oder an seinen Ecken, um den Ausschnitt zu wählen.</p>
        }

        <div class="bb-ende">
          <button type="button" class="neben" (click)="resetAll()" [disabled]="!changed()">Alles zurücksetzen</button>
          <div class="knoepfe">
            <button type="button" class="neben" (click)="cancel.emit()">Abbrechen</button>
            <button type="button" class="haupt" (click)="apply()" [disabled]="!changed() || saving()">Übernehmen</button>
          </div>
        </div>
      </aside>
    </div>
  `,
})
export class ImageEditor implements OnInit, OnDestroy {
  /** Address the picture can be loaded from. */
  readonly src = input.required<string>();
  readonly done = output<Blob>();
  readonly cancel = output<void>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly stage = viewChild.required<ElementRef<HTMLDivElement>>('stage');

  readonly groups = [
    { title: 'Licht', sliders: LICHT },
    { title: 'Farbe', sliders: FARBE },
    { title: 'Details', sliders: SCHAERFE },
  ];
  readonly ratios = RATIOS;
  readonly handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  readonly tab = signal<'anpassen' | 'zuschneiden'>('anpassen');
  readonly adj = signal<Adjustments>({ ...NEUTRAL });
  readonly crop = signal<Crop>({ x: 0, y: 0, w: 1, h: 1 });
  readonly ratioLabel = signal('Frei');
  readonly quarterTurns = signal(0);
  readonly flip = signal(false);
  readonly straighten = signal(0);
  readonly comparing = signal(false);
  readonly saving = signal(false);
  /** Where the picture sits inside the stage, in CSS pixels. */
  readonly view = signal({ x: 0, y: 0, w: 0, h: 0 });

  readonly changed = computed(() => {
    const c = this.crop();
    return !isNeutral(this.adj()) || this.quarterTurns() % 4 !== 0 || this.flip() || this.straighten() !== 0 ||
      c.x !== 0 || c.y !== 0 || c.w !== 1 || c.h !== 1;
  });

  private original: ImageBitmap | null = null;
  private small: HTMLCanvasElement | null = null;
  /** Straightened preview picture (not cropped, not adjusted). */
  private oriented: HTMLCanvasElement | null = null;
  private frame = 0;
  private drag: { handle: Handle; startX: number; startY: number; start: Crop } | null = null;
  private resizeObserver: ResizeObserver | null = null;

  async ngOnInit(): Promise<void> {
    const blob = await (await fetch(this.src())).blob();
    this.original = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const s = Math.min(1, PREVIEW_MAX / Math.max(this.original.width, this.original.height));
    this.small = document.createElement('canvas');
    this.small.width = Math.round(this.original.width * s);
    this.small.height = Math.round(this.original.height * s);
    this.small.getContext('2d')!.drawImage(this.original, 0, 0, this.small.width, this.small.height);
    this.resizeObserver = new ResizeObserver(() => this.redraw());
    this.resizeObserver.observe(this.stage().nativeElement);
    this.rebuild();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.original?.close();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.cancel.emit();
  }

  // ---------------------------------------------------------------- controls

  format(s: Slider): string {
    const v = this.adj()[s.key];
    return s.step < 1 ? (v > 0 ? '+' : '') + v.toFixed(2) : (v > 0 ? '+' : '') + v;
  }

  set(key: keyof Adjustments, value: number): void {
    this.adj.update((a) => ({ ...a, [key]: value }));
    this.redraw();
  }

  auto(): void {
    if (!this.small) return;
    const ctx = this.small.getContext('2d')!;
    this.adj.set(autoAdjust(ctx.getImageData(0, 0, this.small.width, this.small.height)));
    this.redraw();
  }

  /** While the button is held, the unadjusted picture is shown. */
  compare(on: boolean): void {
    if (this.comparing() === on) return;
    this.comparing.set(on);
    this.redraw();
  }

  rotate(dir: number): void {
    this.quarterTurns.update((q) => (q + dir + 4) % 4);
    this.crop.set({ x: 0, y: 0, w: 1, h: 1 });
    this.rebuild();
    this.setRatio(this.ratioLabel());
  }

  setStraighten(deg: number): void {
    this.straighten.set(deg);
    this.rebuild();
  }

  setRatio(label: string): void {
    this.ratioLabel.set(label);
    const r = this.ratioValue();
    if (r && this.oriented) {
      // Largest centred frame with this ratio.
      const W = this.oriented.width, H = this.oriented.height;
      let w = 1, h = (W / r) / H;
      if (h > 1) { h = 1; w = (H * r) / W; }
      this.crop.set({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
    }
    this.redraw();
  }

  resetAll(): void {
    this.adj.set({ ...NEUTRAL });
    this.quarterTurns.set(0);
    this.flip.set(false);
    this.straighten.set(0);
    this.ratioLabel.set('Frei');
    this.crop.set({ x: 0, y: 0, w: 1, h: 1 });
    this.rebuild();
  }

  private ratioValue(): number | null {
    const r = RATIOS.find((x) => x.label === this.ratioLabel())?.value ?? null;
    if (r !== 'original') return r;
    if (!this.oriented) return null;
    return this.quarterTurns() % 2 ? this.original!.height / this.original!.width : this.original!.width / this.original!.height;
  }

  // ---------------------------------------------------------------- crop frame

  startDrag(event: PointerEvent, handle: Handle): void {
    event.stopPropagation();
    event.preventDefault();
    this.drag = { handle, startX: event.clientX, startY: event.clientY, start: { ...this.crop() } };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  @HostListener('document:pointermove', ['$event'])
  onMove(event: PointerEvent): void {
    if (!this.drag || !this.oriented) return;
    const v = this.view();
    const dx = (event.clientX - this.drag.startX) / v.w;
    const dy = (event.clientY - this.drag.startY) / v.h;
    const s = this.drag.start;
    const min = 0.05;
    let { x, y, w, h } = s;
    const hd = this.drag.handle;
    if (hd === 'move') {
      x = Math.min(Math.max(0, s.x + dx), 1 - s.w);
      y = Math.min(Math.max(0, s.y + dy), 1 - s.h);
    } else {
      if (hd.includes('w')) { x = Math.min(Math.max(0, s.x + dx), s.x + s.w - min); w = s.x + s.w - x; }
      if (hd.includes('e')) { w = Math.min(Math.max(min, s.w + dx), 1 - s.x); }
      if (hd.includes('n')) { y = Math.min(Math.max(0, s.y + dy), s.y + s.h - min); h = s.y + s.h - y; }
      if (hd.includes('s')) { h = Math.min(Math.max(min, s.h + dy), 1 - s.y); }
      const r = this.ratioValue();
      if (r) {
        // Keep the ratio: follow the dragged width, fit the height, and shrink if it overflows.
        const W = this.oriented.width, H = this.oriented.height;
        const horizontal = hd === 'e' || hd === 'w';
        if (horizontal || hd.length === 2) h = (w * W) / r / H;
        else w = (h * H * r) / W;
        const anchorBottom = hd.includes('n');
        const anchorRight = hd.includes('w');
        const maxH = anchorBottom ? s.y + s.h : 1 - s.y;
        const maxW = anchorRight ? s.x + s.w : 1 - s.x;
        const scale = Math.min(1, maxH / h, maxW / w);
        w *= scale; h *= scale;
        if (anchorBottom) y = s.y + s.h - h; else y = s.y;
        if (anchorRight) x = s.x + s.w - w; else x = s.x;
      }
    }
    this.crop.set({ x, y, w, h });
  }

  @HostListener('document:pointerup')
  onUp(): void {
    this.drag = null;
  }

  // ---------------------------------------------------------------- drawing

  /** Rotates, flips and straightens `source` onto a new canvas. */
  private orient(source: CanvasImageSource, sw: number, sh: number): HTMLCanvasElement {
    const q = this.quarterTurns();
    const W = q % 2 ? sh : sw;
    const H = q % 2 ? sw : sh;
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d')!;
    const a = (this.straighten() * Math.PI) / 180;
    // Zoom so that straightening never shows empty corners.
    const zoom = Math.max(
      (W * Math.abs(Math.cos(a)) + H * Math.abs(Math.sin(a))) / W,
      (W * Math.abs(Math.sin(a)) + H * Math.abs(Math.cos(a))) / H,
    );
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(W / 2, H / 2);
    ctx.rotate(a + (q * Math.PI) / 2);
    ctx.scale(zoom * (this.flip() ? -1 : 1), zoom);
    ctx.drawImage(source, -sw / 2, -sh / 2, sw, sh);
    return out;
  }

  /** Recomputes the straightened preview after a geometry change. */
  rebuild(): void {
    if (!this.small) return;
    this.oriented = this.orient(this.small, this.small.width, this.small.height);
    this.redraw();
  }

  redraw(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  private draw(): void {
    if (!this.oriented) return;
    const cropping = this.tab() === 'zuschneiden';
    const c = this.crop();
    const src = this.oriented;
    const sx = cropping ? 0 : Math.round(c.x * src.width);
    const sy = cropping ? 0 : Math.round(c.y * src.height);
    const sw = cropping ? src.width : Math.max(1, Math.round(c.w * src.width));
    const sh = cropping ? src.height : Math.max(1, Math.round(c.h * src.height));

    const canvas = this.canvas().nativeElement;
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    if (!this.comparing()) {
      const data = ctx.getImageData(0, 0, sw, sh);
      applyAdjustments(data, this.adj());
      ctx.putImageData(data, 0, 0);
    }

    const stage = this.stage().nativeElement.getBoundingClientRect();
    const pad = 24;
    const scale = Math.min((stage.width - 2 * pad) / sw, (stage.height - 2 * pad) / sh);
    const w = sw * scale, h = sh * scale;
    this.view.set({ x: (stage.width - w) / 2, y: (stage.height - h) / 2, w, h });
  }

  /** Renders the full-size result and hands it over as JPEG (or PNG). */
  async apply(): Promise<void> {
    if (!this.original) return;
    this.saving.set(true);
    const full = this.orient(this.original, this.original.width, this.original.height);
    const c = this.crop();
    const sx = Math.round(c.x * full.width), sy = Math.round(c.y * full.height);
    const sw = Math.max(1, Math.round(c.w * full.width)), sh = Math.max(1, Math.round(c.h * full.height));
    const s = Math.min(1, OUTPUT_MAX / Math.max(sw, sh));
    const out = document.createElement('canvas');
    out.width = Math.round(sw * s);
    out.height = Math.round(sh * s);
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(full, sx, sy, sw, sh, 0, 0, out.width, out.height);
    const data = ctx.getImageData(0, 0, out.width, out.height);
    applyAdjustments(data, this.adj());
    ctx.putImageData(data, 0, 0);
    const png = /\.png($|\?)/i.test(this.src());
    out.toBlob((blob) => {
      this.saving.set(false);
      if (blob) this.done.emit(blob);
    }, png ? 'image/png' : 'image/jpeg', 0.9);
  }
}
