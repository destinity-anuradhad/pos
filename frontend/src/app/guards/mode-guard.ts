import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { TerminalService } from '../services/terminal';

export const modeGuard: CanActivateFn = () => {
  const auth     = inject(AuthService);
  const terminal = inject(TerminalService);
  const router   = inject(Router);

  if (!auth.isLoggedIn()) { router.navigate(['/login']); return false; }
  if (!terminal.isRegistered()) { router.navigate(['/terminal-setup']); return false; }
  return true;
};
