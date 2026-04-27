import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CustomerDisplayRoutingModule } from './customer-display-routing-module';
import { CustomerDisplay } from './customer-display';

@NgModule({
  declarations: [CustomerDisplay],
  imports: [CommonModule, CustomerDisplayRoutingModule]
})
export class CustomerDisplayModule {}
