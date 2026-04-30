import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { TerminalService } from '../services/terminal';

export const modeGuard: CanActivateFn = () => {
  const auth     = inject(AuthService);
  const terminal = inject(TerminalService);
  const router   = inject(Router);

  // Test bypass: Playwright tests seed pos_auth=true to skip login/terminal flow
  if (localStorage.getItem('pos_auth') === 'true') return true;

  if (!terminal.isRegistered()) { router.navigate(['/terminal-setup']); return false; }
  if (!auth.isLoggedIn()) { router.navigate(['/login']); return false; }
  return true;
};
