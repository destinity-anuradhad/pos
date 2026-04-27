import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { AppModeService } from '../services/app-mode';

export const modeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const mode = inject(AppModeService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) { router.navigate(['/login']); return false; }
  if (!mode.getMode())    { router.navigate(['/mode-select']); return false; }
  return true;
};
