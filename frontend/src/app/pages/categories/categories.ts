import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { DatabaseService } from '../../services/database';
import { ApiCategory } from '../../services/api';

@Component({
  selector: 'app-categories',
  standalone: false,
  templateUrl: './categories.html',
  styleUrls: ['./categories.scss']
})
export class Categories implements OnInit {
  categories: ApiCategory[] = [];
  loading = true;
  error = '';

  showForm = false;
  editingId: number | null = null;
  form = { name: '', color: '#094f70', icon: '', sort_order: 0, is_visible: true };
  formError = '';
  saving = false;

  readonly PRESET_COLORS = [
    '#094f70', '#ef4444', '#f59e0b', '#22c55e',
    '#06b6d4', '#8b5cf6', '#ec4899', '#f97316',
    '#64748b', '#0ea5e9', '#84cc16', '#a855f7',
  ];

  constructor(private db: DatabaseService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.categories = await this.db.getCategories();
    } catch {
      this.error = 'Cannot reach server. Start the backend.';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  openAdd(): void {
    this.editingId = null;
    this.form = { name: '', color: '#094f70', icon: '', sort_order: 0, is_visible: true };
    this.formError = '';
    this.showForm = true;
  }

  openEdit(c: ApiCategory): void {
    this.editingId = c.id;
    this.form = {
      name: c.name,
      color: c.color || '#094f70',
      icon: c.icon || '',
      sort_order: c.sort_order ?? 0,
      is_visible: c.is_visible ?? true,
    };
    this.formError = '';
    this.showForm = true;
  }

  async save(): Promise<void> {
    this.formError = '';
    if (!this.form.name.trim()) { this.formError = 'Name is required'; return; }
    this.saving = true;
    const payload: Partial<ApiCategory> = {
      name: this.form.name.trim(),
      color: this.form.color,
      icon: this.form.icon || null,
      sort_order: this.form.sort_order,
      is_visible: this.form.is_visible,
    };
    try {
      if (this.editingId) {
        await this.db.updateCategory(this.editingId, payload);
      } else {
        await this.db.createCategory(payload);
      }
      this.showForm = false;
      await this.load();
    } catch (e: any) {
      this.formError = e.message || 'Failed to save';
    } finally {
      this.saving = false;
      this.cdr.detectChanges();
    }
  }

  async deleteCategory(c: ApiCategory): Promise<void> {
    if (!confirm(`Delete "${c.name}"? Products in this category will lose their category.`)) return;
    try {
      await this.db.deleteCategory(c.id);
      await this.load();
    } catch {
      alert('Failed to delete category.');
    }
  }
}
