import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Layout } from '../layout/layout';
import { Loading } from '../loading/loading';

@NgModule({
  declarations: [Layout, Loading],
  imports: [CommonModule, RouterModule, FormsModule],
  exports: [Layout, Loading, CommonModule, RouterModule, FormsModule]
})
export class SharedModule { }
