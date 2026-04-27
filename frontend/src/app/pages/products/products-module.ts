import { NgModule } from '@angular/core';
import { ProductsRoutingModule } from './products-routing-module';
import { Products } from './products';
import { SharedModule } from '../../shared/shared/shared-module';

@NgModule({
  declarations: [Products],
  imports: [SharedModule, ProductsRoutingModule],
})
export class ProductsModule {}
