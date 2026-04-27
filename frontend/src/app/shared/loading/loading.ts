import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-loading',
  standalone: false,
  templateUrl: './loading.html',
  styleUrls: ['./loading.scss']
})
export class Loading {
  @Input() loading = false;
  @Input() message = 'Loading...';
}
