import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { DatabaseService } from '../../services/database';
import { ApiTable } from '../../services/api';

@Component({
  selector: 'app-tables-page',
  standalone: false,
  templateUrl: './tables.html',
  styleUrls: ['./tables.scss']
})
export class TablesPage implements OnInit {
  tables: ApiTable[] = [];
  loading = true;
  error = '';

  showForm = false;
  editingId: number | null = null;
  form = { name: '', capacity: 4, section: '', is_active: true };
  formError = '';
  saving = false;

  constructor(private db: DatabaseService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.tables = await this.db.getTables();
    } catch {
      this.error = 'Cannot reach server. Start the backend.';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  openAdd(): void {
    this.editingId = null;
    this.form = { name: '', capacity: 4, section: '', is_active: true };
    this.formError = '';
    this.showForm = true;
  }

  openEdit(t: ApiTable): void {
    this.editingId = t.id;
    this.form = { name: t.name, capacity: t.capacity, section: t.section ?? '', is_active: t.is_active };
    this.formError = '';
    this.showForm = true;
  }

  async save(): Promise<void> {
    this.formError = '';
    if (!this.form.name.trim()) { this.formError = 'Table name is required'; return; }
    if (this.form.capacity < 1 || this.form.capacity > 100) { this.formError = 'Capacity must be 1–100'; return; }
    this.saving = true;
    const payload = {
      name: this.form.name.trim(),
      capacity: this.form.capacity,
      section: this.form.section || null,
      is_active: this.form.is_active,
    };
    try {
      if (this.editingId) {
        await this.db.updateTable(this.editingId, payload);
      } else {
        await this.db.createTable(payload);
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

  async deleteTable(t: ApiTable): Promise<void> {
    if (!confirm(`Delete "${t.name}"?`)) return;
    try {
      await this.db.deleteTable(t.id);
      await this.load();
    } catch {
      alert('Failed to delete table.');
    }
  }

  bulkAdd(): void {
    const input = prompt('How many tables to add? (e.g. 5 adds Table 1 through Table 5)');
    if (!input) return;
    const count = parseInt(input, 10);
    if (isNaN(count) || count < 1 || count > 50) { alert('Enter a number between 1 and 50'); return; }
    this._bulkCreate(count);
  }

  private async _bulkCreate(count: number): Promise<void> {
    const start = this.tables.length + 1;
    this.loading = true;
    this.cdr.detectChanges();
    try {
      for (let i = start; i < start + count; i++) {
        await this.db.createTable({ name: `Table ${i}`, capacity: 4 });
      }
      await this.load();
    } catch {
      alert('Failed to create some tables.');
      await this.load();
    }
  }
}
