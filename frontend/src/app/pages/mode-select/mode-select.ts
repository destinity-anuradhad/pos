import { Component } from '@angular/core';
import { Router } from '@angular/router';

// Mode select is disabled — app runs in restaurant mode only.
// This component is kept to avoid breaking the lazy-loaded module reference.
@Component({
  selector: 'app-mode-select',
  standalone: false,
  templateUrl: './mode-select.html',
  styleUrls: ['./mode-select.scss']
})
export class ModeSelect {
  constructor(private router: Router) {
    this.router.navigate(['/dashboard']);
  }
}
