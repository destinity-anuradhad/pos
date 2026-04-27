import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ModeSelectRoutingModule } from './mode-select-routing-module';
import { ModeSelect } from './mode-select';

@NgModule({
  declarations: [ModeSelect],
  imports: [CommonModule, RouterModule, ModeSelectRoutingModule]
})
export class ModeSelectModule {}
