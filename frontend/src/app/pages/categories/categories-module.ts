import { NgModule } from '@angular/core';
import { CategoriesRoutingModule } from './categories-routing-module';
import { Categories } from './categories';
import { SharedModule } from '../../shared/shared/shared-module';

@NgModule({
  declarations: [Categories],
  imports: [CategoriesRoutingModule, SharedModule]
})
export class CategoriesModule {}
