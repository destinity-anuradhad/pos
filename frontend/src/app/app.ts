import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ThemeService } from './services/theme';
import { KeyboardShortcutsService } from './services/keyboard-shortcuts';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.scss'
})
export class App {
  showShortcuts = false;

  constructor(
    private theme: ThemeService,
    private shortcuts: KeyboardShortcutsService,
    private router: Router
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
}
