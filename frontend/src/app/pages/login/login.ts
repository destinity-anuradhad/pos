import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-login',
  standalone: false,
  templateUrl: './login.html',
  styleUrls: ['./login.scss']
})
export class Login {
  pin = '';
  error = '';
  loading = false;

  constructor(private auth: AuthService, private router: Router) {
    if (this.auth.isLoggedIn()) this.auth.redirectAfterLogin();
  }

  onSubmit(): void {
    this.error = '';
    if (!this.pin) { this.error = 'Please enter your PIN.'; return; }
    this.loading = true;
    setTimeout(() => {
      if (this.auth.login(this.pin)) {
        this.auth.redirectAfterLogin();
      } else {
        this.error = 'Incorrect PIN. Please try again.';
        this.pin = '';
      }
      this.loading = false;
    }, 400);
  }

  onPinInput(val: string): void {
    this.pin = val.replace(/\D/g, '').slice(0, 6);
  }
}
