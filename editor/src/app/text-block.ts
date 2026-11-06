import { Component, ElementRef, input, output, signal, viewChild, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { htmlToMarkdown, markdownToHtml } from './blocks';

/**
 * One text paragraph, edited like in a word processor. Only bold, italic and links are
 * offered; pasted text arrives without foreign formatting.
 */
@Component({
  selector: 'app-text-block',
  imports: [FormsModule],
  template: `
    <div class="text-werkzeuge" role="toolbar" aria-label="Textformatierung">
      <button type="button" (mousedown)="$event.preventDefault()" (click)="format('bold')" title="Fett"><b>F</b> Fett</button>
      <button type="button" (mousedown)="$event.preventDefault()" (click)="format('italic')" title="Kursiv"><i>K</i> Kursiv</button>
      <button type="button" (mousedown)="$event.preventDefault()" (click)="startLink()" title="Link">🔗 Link</button>
      <button type="button" (mousedown)="$event.preventDefault()" (click)="format('removeFormat'); format('unlink')" title="Formatierung entfernen">Normal</button>
    </div>
    @if (linking()) {
      <form class="link-eingabe" (ngSubmit)="applyLink()">
        <label>
          Adresse des Links
          <input name="href" [(ngModel)]="href" placeholder="https://…" autofocus />
        </label>
        <button type="submit" class="haupt klein">Übernehmen</button>
        <button type="button" class="neben klein" (click)="linking.set(false)">Abbrechen</button>
      </form>
    }
    <div #box class="textfeld" contenteditable="true" role="textbox" aria-multiline="true"
         spellcheck="true" lang="de"
         (input)="typed()"
         (blur)="commit()"
         (paste)="paste($event)"
         (click)="clickLink($event)"></div>
  `,
})
export class TextBlock {
  readonly markdown = input.required<string>();
  readonly pageDir = input.required<string>();
  readonly edited = output<string>();

  private readonly box = viewChild.required<ElementRef<HTMLDivElement>>('box');
  readonly linking = signal(false);
  href = '';
  dirty = false;
  private savedRange: Range | null = null;
  /** Markdown last shown, so our own updates do not reset the cursor. */
  private shown: string | null = null;

  constructor() {
    effect(() => {
      const md = this.markdown();
      const dir = this.pageDir();
      if (md === this.shown) return;
      this.shown = md;
      this.box().nativeElement.innerHTML = markdownToHtml(md, dir);
      document.execCommand('defaultParagraphSeparator', false, 'p');
    });
  }

  private pause: ReturnType<typeof setTimeout> | null = null;

  /** Saves after a short pause in typing, not only when leaving the field. */
  typed(): void {
    this.dirty = true;
    if (this.pause) clearTimeout(this.pause);
    this.pause = setTimeout(() => this.commit(), 1500);
  }

  format(command: string): void {
    document.execCommand(command);
    this.dirty = true;
  }

  startLink(): void {
    const sel = window.getSelection();
    this.savedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    this.href = 'https://';
    this.linking.set(true);
  }

  applyLink(): void {
    this.linking.set(false);
    const href = this.href.trim();
    if (!href || href === 'https://' || !this.savedRange) return;
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(this.savedRange);
    if (this.savedRange.collapsed) document.execCommand('insertText', false, href);
    // insertText leaves the cursor after the text; select it again to turn it into a link.
    if (this.savedRange.collapsed) {
      const r = sel.getRangeAt(0);
      r.setStart(r.endContainer, Math.max(0, r.endOffset - href.length));
    }
    document.execCommand('createLink', false, href);
    this.dirty = true;
    this.commit();
  }

  paste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
    this.dirty = true;
  }

  /** Links inside the text are for editing, not for following. */
  clickLink(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('a')) event.preventDefault();
  }

  commit(): void {
    if (this.pause) clearTimeout(this.pause);
    if (!this.dirty) return;
    this.dirty = false;
    const md = htmlToMarkdown(this.box().nativeElement.innerHTML);
    this.shown = md;
    this.edited.emit(md);
  }
}
