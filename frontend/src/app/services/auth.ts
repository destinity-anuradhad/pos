import { Injectable } from '@angular/core';
import { Router } from '@angular/router';

const AUTH_KEY   = 'pos_auth';
const DEFAULT_PIN = '1234';

@Injectable({ providedIn: 'root' })
export class AuthService {
  constructor(private router: Router) {}

  login(pin: string): boolean {
    const stored = localStorage.getItem(AUTH_KEY + '_pin') || DEFAULT_PIN;
    if (pin === stored) {
      localStorage.setItem(AUTH_KEY, 'true');
      return true;
    }
    return false;
  }

  redirectAfterLogin(): void {
    this.router.navigate(['/dashboard']);
  }

  logout(): void {
    localStorage.removeItem(AUTH_KEY);
    this.router.navigate(['/login']);
  }

  isLoggedIn(): boolean {
    return localStorage.getItem(AUTH_KEY) === 'true';
  }
}
