import { NgModule } from '@angular/core';
import { OrdersRoutingModule } from './orders-routing-module';
import { Orders } from './orders';
import { SharedModule } from '../../shared/shared/shared-module';

@NgModule({
  declarations: [Orders],
  imports: [SharedModule, OrdersRoutingModule],
})
export class OrdersModule {}
