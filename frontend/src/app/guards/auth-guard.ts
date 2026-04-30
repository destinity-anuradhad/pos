import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  // Test bypass: Playwright tests seed pos_auth=true to skip login flow
  if (localStorage.getItem('pos_auth') === 'true') return true;
  if (auth.isLoggedIn()) return true;
  router.navigate(['/login']);
  return false;
};
