import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Layout } from '../layout/layout';

@NgModule({
  declarations: [Layout],
  imports: [CommonModule, RouterModule],
  exports: [Layout, CommonModule, RouterModule, FormsModule]
})
export class SharedModule { }
