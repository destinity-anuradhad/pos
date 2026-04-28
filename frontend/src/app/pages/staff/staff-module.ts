import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StaffRoutingModule } from './staff-routing-module';
import { StaffPage } from './staff';
import { SharedModule } from '../../shared/shared/shared-module';

@NgModule({
  declarations: [StaffPage],
  imports: [CommonModule, FormsModule, StaffRoutingModule, SharedModule]
})
export class StaffModule {}
