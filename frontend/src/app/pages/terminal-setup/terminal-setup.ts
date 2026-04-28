import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { TerminalService } from '../../services/terminal';

@Component({
  selector: 'app-terminal-setup',
  standalone: false,
  templateUrl: './terminal-setup.html',
  styleUrls: ['./terminal-setup.scss']
})
export class TerminalSetup {
  terminalCode = '';
  terminalName = '';
  adminPin     = '';
  saving       = false;
  error        = '';

  readonly platform: string;

  constructor(public terminal: TerminalService, private router: Router) {
    this.platform = terminal.getPlatform();
  }

  get platformLabel(): string {
    const map: Record<string, string> = {
      windows: 'Windows Desktop',
      macos:   'macOS Desktop',
      android: 'Android',
      ios:     'iOS',
      web:     'Web Browser',
    };
    return map[this.platform] || this.platform;
  }

  get codePlaceholder(): string {
    const map: Record<string, string> = {
      windows: 'e.g. COL-W-01',
      android: 'e.g. COL-M-01',
      web:     'e.g. COL-WEB-01',
    };
    return map[this.platform] || 'e.g. COL-M-01';
  }

  async save(): Promise<void> {
    this.error = '';
    if (!this.terminalCode.trim()) { this.error = 'Terminal code is required.'; return; }
    if (!this.terminalName.trim()) { this.error = 'Terminal name is required.'; return; }
    if (this.adminPin !== '1234')  { this.error = 'Invalid admin PIN.'; return; }

    this.saving = true;
    try {
      await this.terminal.register(this.terminalCode, this.terminalName);
      this.router.navigate(['/dashboard']);
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg.includes('409') || msg.includes('already')) {
        this.error = `Terminal code "${this.terminalCode.toUpperCase()}" is already registered. Choose a different code.`;
      } else if (msg.includes('Failed to fetch') || msg.includes('abort')) {
        this.error = 'Cannot reach server. Make sure the backend is running.';
      } else {
        this.error = `Registration failed: ${msg || 'unknown error'}`;
      }
    } finally {
      this.saving = false;
    }
  }
}
