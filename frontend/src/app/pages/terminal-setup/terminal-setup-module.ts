import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TerminalSetup } from './terminal-setup';

@NgModule({
  declarations: [TerminalSetup],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: TerminalSetup }])
  ]
})
export class TerminalSetupModule {}
