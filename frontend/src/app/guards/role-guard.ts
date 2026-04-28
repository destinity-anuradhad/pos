import { inject } from '@angular/core';
import { CanActivateFn, Router, ActivatedRouteSnapshot } from '@angular/router';
import { AuthService } from '../services/auth';

export const roleGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const roles: string[] = route.data['roles'] || [];
  if (!auth.isLoggedIn()) { router.navigate(['/login']); return false; }
  if (roles.length === 0) return true;
  if (auth.hasRole(...roles)) return true;
  router.navigate(['/dashboard']);
  return false;
};
