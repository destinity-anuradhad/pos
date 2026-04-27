import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AppModeService, AppMode } from '../../services/app-mode';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-mode-select',
  standalone: false,
  templateUrl: './mode-select.html',
  styleUrls: ['./mode-select.scss']
})
export class ModeSelect {
  constructor(
    private modeService: AppModeService,
    private auth: AuthService,
    private router: Router
  ) {
    if (!this.auth.isLoggedIn()) this.router.navigate(['/login']);
  }

  select(mode: AppMode): void {
    this.modeService.setMode(mode);
    this.router.navigate(['/dashboard']);
  }

  logout(): void {
    this.auth.logout();
  }
}
