import { Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StatusService } from './status.service';

/** First start on a new PC: who edits, and the access key for the website. */
@Component({
  selector: 'app-setup',
  imports: [FormsModule],
  template: `
    <main class="setup">
      <h1>Willkommen!</h1>
      <p class="gross">
        Dieses Programm wird einmal pro Computer eingerichtet. Danach öffnet es sich direkt.
      </p>
      <form (ngSubmit)="submit()">
        <label>
          Ihr Name
          <span class="hilfe">Wird bei jeder Veröffentlichung vermerkt.</span>
          <input name="name" [(ngModel)]="name" required autocomplete="name" />
        </label>
        <label>
          Zugangsschlüssel
          <span class="hilfe">Beginnt mit „ghp_“. Wird sicher auf diesem Computer gespeichert.</span>
          <input name="token" type="password" [(ngModel)]="token" required autocomplete="off" />
        </label>
        <details>
          <summary>Erweitert</summary>
          <label>
            Adresse der Website-Daten
            <input name="url" [(ngModel)]="repoUrl" required />
          </label>
        </details>
        <button class="haupt" type="submit" [disabled]="!name.trim() || !token.trim()">
          Einrichten
        </button>
      </form>
    </main>
  `,
})
export class Setup {
  private readonly status = inject(StatusService);
  readonly initialUrl = input.required<string>();
  readonly done = output<void>();

  name = '';
  token = '';
  repoUrl = '';

  ngOnInit(): void {
    this.repoUrl = this.initialUrl();
  }

  async submit(): Promise<void> {
    const ok = await this.status.run('Website wird heruntergeladen', async () => {
      await window.starbush.setup({ repoUrl: this.repoUrl, token: this.token, editorName: this.name });
      return true;
    });
    if (ok) this.done.emit();
  }
}
