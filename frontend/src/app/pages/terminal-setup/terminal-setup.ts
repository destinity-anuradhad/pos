import { Component, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { TerminalService } from '../../services/terminal';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-terminal-setup',
  standalone: false,
  templateUrl: './terminal-setup.html',
  styleUrls: ['./terminal-setup.scss']
})
export class TerminalSetup {
  terminalCode = '';
  terminalName = '';
  outletCode   = '';
  outletName   = '';
  adminPin     = '';
  saving       = false;
  error        = '';

  readonly platform: string;

  constructor(
    public terminal: TerminalService,
    private auth: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {
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

  /** 6-digit PIN numpad */
  get pinDots(): boolean[] {
    return Array.from({ length: 6 }, (_, i) => i < this.adminPin.length);
  }

  pressDigit(d: string): void {
    if (this.adminPin.length < 6) {
      this.adminPin += d;
      this.error = '';
      if (this.adminPin.length === 6) this.save();
    }
  }

  pressBack(): void {
    this.adminPin = this.adminPin.slice(0, -1);
  }

  async save(): Promise<void> {
    this.error = '';
    if (!this.outletCode.trim())   { this.error = 'Outlet code is required.'; return; }
    if (!this.outletName.trim())   { this.error = 'Outlet name is required.'; return; }
    if (!this.terminalCode.trim()) { this.error = 'Terminal code is required.'; return; }
    if (!this.terminalName.trim()) { this.error = 'Terminal name is required.'; return; }
    if (this.adminPin.length < 6)  { this.error = 'Enter the 6-digit admin PIN.'; return; }

    this.saving = true;
    try {
      console.log('[setup] Verifying admin PIN...');
      const result = await this.auth.login('admin', this.adminPin, false);
      console.log('[setup] auth.login result:', result.success, result.error);
      if (!result.success) {
        this.error = 'Invalid admin PIN.';
        this.adminPin = '';
        this.cdr.detectChanges();
        return;
      }

      console.log('[setup] Registering terminal...');
      await this.terminal.register(this.terminalCode, this.terminalName, this.outletCode, this.outletName);
      console.log('[setup] Registration successful, navigating to dashboard');
      this.router.navigate(['/dashboard']);
    } catch (e: any) {
      const msg = e?.message || '';
      console.error('[setup] Registration error:', msg);
      if (msg.includes('409') || msg.includes('already')) {
        this.error = `Terminal code "${this.terminalCode.toUpperCase()}" is already registered.`;
      } else if (msg.includes('Failed to fetch') || msg.includes('abort')) {
        this.error = 'Cannot reach server. Make sure the backend is running.';
      } else {
        this.error = `Registration failed: ${msg || 'unknown error'}`;
      }
      this.adminPin = '';
    } finally {
      this.saving = false;
      this.cdr.detectChanges();
    }
  }
}
