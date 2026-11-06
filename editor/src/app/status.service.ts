import { Injectable, signal } from '@angular/core';
import type { Progress } from './api';

export interface Notice {
  id: number;
  text: string;
  kind: 'info' | 'fehler';
}

/** App-wide messages and the "please wait" overlay. */
@Injectable({ providedIn: 'root' })
export class StatusService {
  readonly busy = signal<Progress | null>(null);
  readonly notices = signal<Notice[]>([]);
  private nextId = 1;

  constructor() {
    window.starbush.onProgress((p) => {
      if (this.busy()) this.busy.set(p);
    });
  }

  info(text: string): void {
    this.push(text, 'info', 5000);
  }

  error(e: unknown): void {
    const text = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e);
    console.error(e);
    this.push(text, 'fehler', 12000);
  }

  dismiss(id: number): void {
    this.notices.update((list) => list.filter((n) => n.id !== id));
  }

  /** Shows the overlay while `job` runs; errors become a message. */
  async run<T>(phase: string, job: () => Promise<T>): Promise<T | undefined> {
    this.busy.set({ phase, percent: -1 });
    try {
      return await job();
    } catch (e) {
      this.error(e);
      return undefined;
    } finally {
      this.busy.set(null);
    }
  }

  private push(text: string, kind: Notice['kind'], ms: number): void {
    const id = this.nextId++;
    this.notices.update((list) => [...list, { id, text, kind }]);
    setTimeout(() => this.dismiss(id), ms);
  }
}
