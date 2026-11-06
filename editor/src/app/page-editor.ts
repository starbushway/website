import { NgTemplateOutlet } from '@angular/common';
import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PageInfo } from './api';
import { Block, imageUrl, newId, parseBody, Photo, PHOTO_SIZES, PhotoSize, serializeBody } from './blocks';
import { ImageEditor } from './image-editor';
import { prepareImage } from './images';
import { StatusService } from './status.service';
import { TextBlock } from './text-block';

const SAVE_DELAY_MS = 800;

/** Edits one page: its title, text blocks and photo rows. Saves by itself. */
@Component({
  selector: 'app-page-editor',
  imports: [FormsModule, NgTemplateOutlet, TextBlock, ImageEditor],
  template: `
    <div class="editor">
      <div class="editor-kopf">
        <label class="titel-feld">
          Seitentitel
          <input [ngModel]="title()" (ngModelChange)="title.set($event); changed()" />
        </label>
        <div class="speicherstand" aria-live="polite">
          @switch (saveState()) {
            @case ('saving') { Wird gespeichert … }
            @case ('saved') { ✓ Gespeichert }
          }
        </div>
        <button type="button" class="neben" (click)="undo()" [disabled]="!history().length">
          ↶ Rückgängig
        </button>
        @if (!page().isSection) {
          <button type="button" class="neben loeschen" (click)="deletePage.emit()" title="Diese Seite mit allen Fotos löschen">
            🗑 Seite löschen
          </button>
        }
      </div>

      <ng-template #insert let-index>
        <div class="einfuegen">
          <button type="button" (click)="addText(index)">＋ Text</button>
          <button type="button" (click)="addPhotos(index)">＋ Fotos</button>
        </div>
      </ng-template>

      <ng-container [ngTemplateOutlet]="insert" [ngTemplateOutletContext]="{ $implicit: 0 }" />
      @for (block of blocks(); track block.id; let i = $index, first = $first, last = $last) {
        <div class="block" [class.fotoblock]="block.kind === 'photos'">
          <div class="block-knoepfe">
            <button type="button" (click)="move(i, -1)" [disabled]="first" title="Nach oben schieben" aria-label="Nach oben schieben">▲</button>
            <button type="button" (click)="move(i, 1)" [disabled]="last" title="Nach unten schieben" aria-label="Nach unten schieben">▼</button>
            <button type="button" class="loeschen" (click)="remove(i)" title="Diesen Abschnitt löschen" aria-label="Abschnitt löschen">🗑</button>
          </div>

          @if (block.kind === 'text') {
            <app-text-block [markdown]="block.md" [pageDir]="page().dir"
                            (edited)="setText(block.id, $event)" />
          } @else {
            <div class="fotoreihe"
                 (dragover)="$event.preventDefault()"
                 (drop)="drop($event, block.id)">
              @for (photo of block.photos; track $index; let j = $index, pf = $first, pl = $last) {
                <figure class="foto">
                  <img [src]="url(photo)" [alt]="photo.alt" loading="lazy" />
                  @if (photo.href) {
                    <figcaption title="Dieses Foto ist ein Link: {{ photo.href }}">🔗 verlinkt</figcaption>
                  }
                  <div class="foto-knoepfe">
                    <button type="button" (click)="movePhoto(block.id, j, -1)" [disabled]="pf" aria-label="Foto nach links">◀</button>
                    <button type="button" (click)="editing.set({ block: block.id, index: j, src: url(photo) })"
                            title="Zuschneiden, Licht und Farben anpassen" aria-label="Foto bearbeiten">✎</button>
                    <button type="button" class="loeschen" (click)="removePhoto(block.id, j)" aria-label="Foto löschen">🗑</button>
                    <button type="button" (click)="movePhoto(block.id, j, 1)" [disabled]="pl" aria-label="Foto nach rechts">▶</button>
                  </div>
                  <label class="foto-groesse">
                    <span class="unsichtbar">Größe auf der Website</span>
                    <select [ngModel]="photo.size ?? ''" (ngModelChange)="setSize(block.id, j, $event || undefined)"
                            title="Wie groß das Foto auf der Website erscheint">
                      @for (s of sizes; track s.label) {
                        <option [value]="s.value ?? ''">{{ s.label }}</option>
                      }
                    </select>
                  </label>
                </figure>
              }
              <label class="foto-hinzu">
                <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple
                       (change)="pick($event, block.id)" />
                <span>＋<br />Fotos hinzufügen</span>
                <span class="hilfe">oder hierher ziehen</span>
              </label>
            </div>
          }
        </div>
        <ng-container [ngTemplateOutlet]="insert" [ngTemplateOutletContext]="{ $implicit: i + 1 }" />
      }
    </div>

    @if (editing(); as e) {
      <app-image-editor [src]="e.src" (done)="saveEdited($event)" (cancel)="editing.set(null)" />
    }
  `,
})
export class PageEditor {
  private readonly status = inject(StatusService);
  readonly page = input.required<PageInfo>();
  readonly saved = output<void>();
  readonly deletePage = output<void>();
  readonly sizes = PHOTO_SIZES;
  /** The photo open in the image editor. */
  readonly editing = signal<{ block: number; index: number; src: string } | null>(null);

  readonly title = signal('');
  readonly blocks = signal<Block[]>([]);
  readonly history = signal<{ title: string; blocks: Block[] }[]>([]);
  readonly saveState = signal<'idle' | 'saving' | 'saved'>('idle');

  private loadedDir: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const dir = this.page().dir;
      if (dir !== this.loadedDir) void this.load(dir);
    });
  }

  url(photo: Photo): string {
    return imageUrl(photo.src, this.page().dir);
  }

  /** Re-reads the page from disk, e.g. after discarding changes. */
  reload(): void {
    void this.load(this.page().dir);
  }

  private async load(dir: string): Promise<void> {
    this.loadedDir = dir;
    try {
      const content = await window.starbush.readPage(dir);
      if (this.loadedDir !== dir) return;
      this.title.set(content.title);
      this.blocks.set(parseBody(content.body));
      this.history.set([]);
      this.saveState.set('idle');
    } catch (e) {
      this.status.error(e);
    }
  }

  // ---------------------------------------------------------------- saving

  /** Remembers the state for "Rückgängig" before a change. */
  private snapshot(): void {
    this.history.update((h) => [...h.slice(-49), { title: this.title(), blocks: structuredClone(this.blocks()) }]);
  }

  changed(): void {
    this.saveState.set('saving');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  /** Saves now if a save is pending. */
  async flush(): Promise<void> {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    const dir = this.loadedDir;
    if (dir === null) return;
    try {
      await window.starbush.savePage(dir, { title: this.title(), body: serializeBody(this.blocks()) });
      this.saveState.set('saved');
      this.saved.emit();
    } catch (e) {
      this.status.error(e);
    }
  }

  undo(): void {
    const last = this.history().at(-1);
    if (!last) return;
    this.history.update((h) => h.slice(0, -1));
    this.title.set(last.title);
    this.blocks.set(last.blocks);
    this.changed();
  }

  private update(fn: (blocks: Block[]) => Block[]): void {
    this.snapshot();
    this.blocks.update(fn);
    this.changed();
  }

  private updatePhotos(id: number, fn: (photos: Photo[]) => Photo[]): void {
    this.update((blocks) =>
      blocks.map((b) => (b.id === id && b.kind === 'photos' ? { ...b, photos: fn([...b.photos]), raw: undefined } : b)),
    );
  }

  // ---------------------------------------------------------------- blocks

  setText(id: number, md: string): void {
    this.update((blocks) => blocks.map((b) => (b.id === id && b.kind === 'text' ? { ...b, md } : b)));
  }

  addText(index: number): void {
    this.update((blocks) => blocks.toSpliced(index, 0, { id: newId(), kind: 'text', md: 'Neuer Text' }));
  }

  addPhotos(index: number): void {
    this.update((blocks) => blocks.toSpliced(index, 0, { id: newId(), kind: 'photos', photos: [] }));
  }

  move(index: number, delta: number): void {
    this.update((blocks) => {
      const copy = [...blocks];
      const [b] = copy.splice(index, 1);
      copy.splice(index + delta, 0, b!);
      return copy;
    });
  }

  remove(index: number): void {
    this.update((blocks) => blocks.toSpliced(index, 1));
    this.status.info('Abschnitt gelöscht. Mit „Rückgängig“ holen Sie ihn zurück.');
  }

  // ---------------------------------------------------------------- photos

  movePhoto(id: number, index: number, delta: number): void {
    this.updatePhotos(id, (photos) => {
      const [p] = photos.splice(index, 1);
      photos.splice(index + delta, 0, p!);
      return photos;
    });
  }

  removePhoto(id: number, index: number): void {
    this.updatePhotos(id, (photos) => photos.toSpliced(index, 1));
    this.status.info('Foto entfernt. Mit „Rückgängig“ holen Sie es zurück.');
  }

  setSize(id: number, index: number, size: PhotoSize | undefined): void {
    this.updatePhotos(id, (photos) => photos.map((p, i) => {
      if (i !== index) return p;
      const { size: _old, ...rest } = p;
      return size ? { ...rest, size } : rest;
    }));
  }

  /** The edited photo becomes a new file; the old one stays until publishing (for undo). */
  async saveEdited(blob: Blob): Promise<void> {
    const e = this.editing();
    if (!e) return;
    const block = this.blocks().find((b) => b.id === e.block);
    const photo = block?.kind === 'photos' ? block.photos[e.index] : undefined;
    if (!photo) return;
    const stem = photo.src.split('/').pop()!.replace(/\.[^.]+$/, '').replace(/-bearbeitet(-\d+)?$/, '');
    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
    const name = await this.status.run('Foto wird gespeichert', async () =>
      window.starbush.addImage(this.page().dir, `${stem}-bearbeitet.${ext}`, await blob.arrayBuffer()));
    if (!name) return;
    this.editing.set(null);
    this.updatePhotos(e.block, (photos) => photos.map((p, i) => (i === e.index ? { ...p, src: name } : p)));
  }

  pick(event: Event, id: number): void {
    const inputEl = event.target as HTMLInputElement;
    const files = [...(inputEl.files ?? [])];
    inputEl.value = '';
    void this.addFiles(files, id);
  }

  drop(event: DragEvent, id: number): void {
    event.preventDefault();
    const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    void this.addFiles(files, id);
  }

  private async addFiles(files: File[], id: number): Promise<void> {
    if (!files.length) return;
    const dir = this.page().dir;
    const added = await this.status.run(
      files.length === 1 ? 'Foto wird eingefügt' : `${files.length} Fotos werden eingefügt`,
      async () => {
        const photos: Photo[] = [];
        for (const file of files) {
          const img = await prepareImage(file);
          const name = await window.starbush.addImage(dir, img.name, img.data);
          photos.push({ src: name, alt: '', size: 'mittel' });
        }
        return photos;
      },
    );
    if (added?.length) this.updatePhotos(id, (photos) => [...photos, ...added]);
  }
}
