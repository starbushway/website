import { Component, inject, OnInit, signal } from '@angular/core';
import type { AppState } from './api';
import { Setup } from './setup';
import { StatusService } from './status.service';
import { Workspace } from './workspace';

@Component({
  selector: 'app-root',
  imports: [Setup, Workspace],
  template: `
    @if (state(); as s) {
      @if (s.configured && s.cloned) {
        <app-workspace />
      } @else {
        <app-setup [initialUrl]="s.repoUrl" (done)="load()" />
      }
    }

    @if (status.busy(); as busy) {
      <div class="warten" role="alertdialog" aria-live="assertive">
        <div class="warten-box">
          <div class="kreisel" aria-hidden="true"></div>
          <p>{{ busy.phase }} …</p>
          @if (busy.percent >= 0) {
            <progress max="100" [value]="busy.percent"></progress>
          }
          <p class="hilfe">Bitte warten Sie, das Programm arbeitet.</p>
        </div>
      </div>
    }

    <div class="meldungen" aria-live="polite">
      @for (n of status.notices(); track n.id) {
        <div class="meldung" [class.fehler]="n.kind === 'fehler'">
          <span>{{ n.text }}</span>
          <button type="button" (click)="status.dismiss(n.id)" aria-label="Meldung schließen">✕</button>
        </div>
      }
    </div>
  `,
})
export class App implements OnInit {
  readonly status = inject(StatusService);
  readonly state = signal<AppState | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.state.set(await window.starbush.getState());
  }
}
