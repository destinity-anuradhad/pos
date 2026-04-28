import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ThemeService } from './services/theme';
import { KeyboardShortcutsService } from './services/keyboard-shortcuts';
import { TerminalService } from './services/terminal';
import { SyncService } from './services/sync';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.scss'
})
export class App implements OnInit {
  showShortcuts = false;

  constructor(
    private theme: ThemeService,
    private shortcuts: KeyboardShortcutsService,
    private router: Router,
    private terminal: TerminalService,
    private sync: SyncService,
  ) {
    this.theme.init();
    this.shortcuts.enable();
    this.shortcuts.action.subscribe(action => {
      switch (action) {
        case 'goDashboard': this.router.navigate(['/dashboard']); break;
        case 'goPos':       this.router.navigate(['/pos']); break;
        case 'goProducts':  this.router.navigate(['/products']); break;
        case 'goOrders':    this.router.navigate(['/orders']); break;
        case 'toggleDark':  this.theme.toggle(); break;
        case 'help':        this.showShortcuts = !this.showShortcuts; break;
      }
    });
  }

  async ngOnInit(): Promise<void> {
    // Verify terminal registration with cloud (non-blocking)
    if (navigator.onLine) {
      this.terminal.verifyWithCloud().catch(() => {});
    }

    // Start auto-sync timer
    this.sync.startAutoSync().catch(() => {});

    // Initial sync if online
    if (navigator.onLine && this.terminal.isRegistered()) {
      setTimeout(() => this.sync.syncAll().catch(() => {}), 3000);
    }
  }
}
