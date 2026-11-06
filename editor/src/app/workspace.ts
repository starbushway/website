import { Component, computed, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import type { Change, PageInfo } from './api';
import { PageEditor } from './page-editor';
import { StatusService } from './status.service';

interface Section {
  page: PageInfo;
  children: PageInfo[];
}

/** Main screen: page list on the left, the chosen page on the right, publish on top. */
@Component({
  selector: 'app-workspace',
  imports: [FormsModule, PageEditor],
  template: `
    <header class="leiste">
      <div class="leiste-titel">Starbushway · Website bearbeiten</div>
      <div class="leiste-status">
        @if (changes().length) {
          <strong>{{ changes().length }} {{ changes().length === 1 ? 'Änderung' : 'Änderungen' }}</strong>
          noch nicht veröffentlicht
        } @else {
          Alles veröffentlicht ✓
        }
      </div>
      <button type="button" class="neben" (click)="discard()" [disabled]="!changes().length">
        Änderungen verwerfen
      </button>
      <button type="button" class="haupt" (click)="publish()" [disabled]="!changes().length">
        Veröffentlichen
      </button>
    </header>

    <div class="arbeitsflaeche">
      <nav class="seitenliste" aria-label="Seiten">
        <label class="suche">
          <span class="unsichtbar">Seite suchen</span>
          <input type="search" placeholder="Seite suchen …" [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </label>
        <ul>
          @for (s of visibleSections(); track s.page.dir) {
            <li>
              <button type="button" class="bereich" [class.aktiv]="s.page.dir === current()?.dir"
                      (click)="open(s.page)">
                {{ s.page.title }}
              </button>
              @if (isExpanded(s)) {
                <ul>
                  @for (p of s.children; track p.dir) {
                    <li>
                      <button type="button" class="unterseite" [class.aktiv]="p.dir === current()?.dir"
                              (click)="open(p)">{{ p.title }}</button>
                    </li>
                  }
                  @if (s.page.dir) {
                    <li>
                      @if (creatingIn() === s.page.dir) {
                        <form class="neue-seite" (ngSubmit)="createPage(s.page)">
                          <label>
                            Name der neuen Seite
                            <input name="title" [(ngModel)]="newTitle" required autofocus />
                          </label>
                          <div class="knoepfe">
                            <button type="submit" class="haupt klein" [disabled]="!newTitle.trim()">Anlegen</button>
                            <button type="button" class="neben klein" (click)="creatingIn.set(null)">Abbrechen</button>
                          </div>
                        </form>
                      } @else {
                        <button type="button" class="neu" (click)="startCreate(s.page)">＋ Neue Seite hier</button>
                      }
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ul>
      </nav>

      <section class="inhaltbereich">
        @if (current(); as page) {
          <div class="ansicht-wahl" role="tablist">
            <button type="button" role="tab" [attr.aria-selected]="!showPreview()" (click)="showPreview.set(false)">
              ✎ Bearbeiten
            </button>
            <button type="button" role="tab" [attr.aria-selected]="showPreview()" (click)="openPreview()">
              👁 Vorschau
            </button>
          </div>
          @if (showPreview()) {
            @if (previewUrl(); as url) {
              <iframe class="vorschau" [src]="url" title="Vorschau der Seite"></iframe>
            } @else {
              <p class="gross">Vorschau wird vorbereitet …</p>
            }
          } @else {
            <app-page-editor [page]="page" (saved)="onSaved()" (deletePage)="askDelete(page)" />
          }
        } @else {
          <div class="willkommen">
            <h1>Guten Tag{{ greetingName() }}!</h1>
            <p class="gross">Wählen Sie links eine Seite aus, die Sie bearbeiten möchten.</p>
            <p>Ihre Änderungen werden sofort auf diesem Computer gespeichert. Im Internet erscheinen sie
              erst, wenn Sie oben auf <strong>Veröffentlichen</strong> klicken.</p>
          </div>
        }
      </section>
    </div>

    @if (deleting(); as d) {
      <div class="warten" role="alertdialog" aria-modal="true" aria-labelledby="loeschen-titel">
        <div class="dialog">
          <h2 id="loeschen-titel">Seite „{{ d.page.title }}“ löschen?</h2>
          <p>Die Seite und alle ihre Fotos werden gelöscht.</p>
          @if (d.linking.length) {
            <p>Auf {{ d.linking.length === 1 ? 'dieser Seite' : 'diesen Seiten' }} wird der Verweis darauf entfernt
              (verlinkte Fotos verschwinden, Textlinks werden zu normalem Text):</p>
            <ul>
              @for (l of d.linking; track l.dir) { <li>{{ l.title }}</li> }
            </ul>
          } @else {
            <p>Keine andere Seite verweist darauf.</p>
          }
          <p class="hilfe">Bis zum Veröffentlichen können Sie das mit „Änderungen verwerfen“ zurücknehmen.</p>
          <div class="knoepfe">
            <button type="button" class="neben" (click)="deleting.set(null)" autofocus>Abbrechen</button>
            <button type="button" class="haupt" (click)="confirmDelete(d.page)">Ja, Seite löschen</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class Workspace implements OnInit {
  private readonly status = inject(StatusService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly editor = viewChild(PageEditor);

  readonly pages = signal<PageInfo[]>([]);
  readonly changes = signal<Change[]>([]);
  readonly current = signal<PageInfo | null>(null);
  readonly search = signal('');
  readonly showPreview = signal(false);
  readonly previewBase = signal<string | null>(null);
  readonly creatingIn = signal<string | null>(null);
  readonly editorName = signal('');
  readonly deleting = signal<{ page: PageInfo; linking: PageInfo[] } | null>(null);
  newTitle = '';

  readonly sections = computed<Section[]>(() => {
    const all = this.pages();
    const byTitle = (a: PageInfo, b: PageInfo) => a.title.localeCompare(b.title, 'de');
    const sections = all
      .filter((p) => p.isSection)
      .sort((a, b) => (a.dir === '' ? -1 : b.dir === '' ? 1 : (a.weight || 999) - (b.weight || 999) || byTitle(a, b)));
    return sections.map((page) => ({
      page,
      children: page.dir ? all.filter((p) => !p.isSection && p.section === page.dir).sort(byTitle) : [],
    }));
  });

  readonly visibleSections = computed<Section[]>(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return this.sections();
    return this.sections()
      .map((s) => ({ page: s.page, children: s.children.filter((p) => p.title.toLowerCase().includes(q)) }))
      .filter((s) => s.children.length || s.page.title.toLowerCase().includes(q));
  });

  readonly previewUrl = computed(() => {
    const base = this.previewBase();
    const page = this.current();
    if (!base || !page) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(base + (page.dir ? page.dir + '/' : ''));
  });

  readonly greetingName = computed(() => (this.editorName() ? `, ${this.editorName()}` : ''));

  async ngOnInit(): Promise<void> {
    const state = await window.starbush.getState();
    this.editorName.set(state.editorName);
    await this.status.run('Neueste Version der Website wird geholt', async () => {
      const result = await window.starbush.sync();
      if (result.updated) this.status.info('Die Website wurde auf den neuesten Stand gebracht.');
    });
    await this.refresh();
    // Start the preview in the background so it is ready when needed.
    window.starbush.previewBase().then((url) => this.previewBase.set(url), (e) => this.status.error(e));
  }

  isExpanded(s: Section): boolean {
    if (this.search().trim()) return true;
    const cur = this.current();
    return !!cur && !!s.page.dir && cur.section === s.page.dir;
  }

  async open(page: PageInfo): Promise<void> {
    await this.editor()?.flush();
    this.current.set(page);
    this.creatingIn.set(null);
  }

  async openPreview(): Promise<void> {
    await this.editor()?.flush();
    this.showPreview.set(true);
  }

  startCreate(section: PageInfo): void {
    this.newTitle = '';
    this.creatingIn.set(section.dir);
  }

  async createPage(section: PageInfo): Promise<void> {
    const title = this.newTitle.trim();
    if (!title) return;
    await this.editor()?.flush();
    const dir = await this.status.run('Seite wird angelegt', () => window.starbush.createPage(section.dir, title));
    if (!dir) return;
    this.creatingIn.set(null);
    await this.refresh();
    const page = this.pages().find((p) => p.dir === dir);
    if (page) {
      this.current.set(page);
      this.showPreview.set(false);
      this.status.info(`Die Seite „${title}“ wurde angelegt und auf „${section.title}“ verlinkt.`);
    }
  }

  async askDelete(page: PageInfo): Promise<void> {
    await this.editor()?.flush();
    const linking = await this.status.run('Verweise werden gesucht', () => window.starbush.linkingPages(page.dir));
    if (linking) this.deleting.set({ page, linking });
  }

  async confirmDelete(page: PageInfo): Promise<void> {
    this.deleting.set(null);
    const changed = await this.status.run('Seite wird gelöscht', () => window.starbush.deletePage(page.dir));
    if (!changed) return;
    await this.refresh();
    // Continue on the menu section the page belonged to.
    this.current.set(this.pages().find((p) => p.isSection && p.dir === page.section) ?? null);
    this.showPreview.set(false);
    this.status.info(`Die Seite „${page.title}“ wurde gelöscht.` +
      (changed.length ? ` Verweise entfernt auf: ${changed.map((c) => c.title).join(', ')}.` : ''));
  }

  async onSaved(): Promise<void> {
    this.changes.set(await window.starbush.changes());
    const cur = this.current();
    if (cur) {
      // The title may have changed.
      const pages = await window.starbush.listPages();
      this.pages.set(pages);
      this.current.set(pages.find((p) => p.dir === cur.dir) ?? cur);
    }
  }

  async publish(): Promise<void> {
    await this.editor()?.flush();
    const done = await this.status.run('Website wird veröffentlicht', async () => {
      await window.starbush.publish();
      return true;
    });
    if (done) {
      await this.refresh();
      this.status.info('Veröffentlicht! In etwa zwei Minuten ist alles im Internet zu sehen.');
    }
  }

  async discard(): Promise<void> {
    const n = this.changes().length;
    if (!confirm(`Wirklich ${n === 1 ? 'die Änderung' : `alle ${n} Änderungen`} verwerfen? Das kann nicht rückgängig gemacht werden.`)) return;
    await this.editor()?.flush();
    await this.status.run('Änderungen werden verworfen', () => window.starbush.discard());
    await this.refresh();
    this.editor()?.reload();
    this.status.info('Alle Änderungen wurden verworfen.');
  }

  private async refresh(): Promise<void> {
    const [pages, changes] = await Promise.all([window.starbush.listPages(), window.starbush.changes()]);
    this.pages.set(pages);
    this.changes.set(changes);
    const cur = this.current();
    if (cur) this.current.set(pages.find((p) => p.dir === cur.dir) ?? null);
  }
}
