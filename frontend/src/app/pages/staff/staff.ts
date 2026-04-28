import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { StaffApiService, Staff } from '../../services/staff-api';

@Component({
  selector: 'app-staff',
  standalone: false,
  templateUrl: './staff.html',
  styleUrls: ['./staff.scss']
})
export class StaffPage implements OnInit {
  staffList: Staff[] = [];
  loading = true;
  error = '';
  showForm = false;
  editingId: number | null = null;
  form = { name: '', role: 'cashier', pin: '', confirmPin: '' };
  formError = '';
  saving = false;

  readonly ROLES = ['cashier', 'manager', 'admin'];
  readonly ROLE_LABELS: Record<string, string> = { cashier: 'Cashier', manager: 'Manager', admin: 'Admin' };
  readonly ROLE_COLORS: Record<string, string> = { cashier: '#22c55e', manager: '#f59e0b', admin: '#ef4444' };

  constructor(private api: StaffApiService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try {
      this.staffList = await this.api.list();
    } catch (e: any) {
      this.error = e.message || 'Failed to load staff';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  openAdd(): void {
    this.editingId = null;
    this.form = { name: '', role: 'cashier', pin: '', confirmPin: '' };
    this.formError = '';
    this.showForm = true;
  }

  openEdit(s: Staff): void {
    this.editingId = s.id;
    this.form = { name: s.name, role: s.role, pin: '', confirmPin: '' };
    this.formError = '';
    this.showForm = true;
  }

  async save(): Promise<void> {
    this.formError = '';
    if (!this.form.name.trim()) { this.formError = 'Name is required'; return; }
    if (!this.editingId && !this.form.pin) { this.formError = 'PIN is required'; return; }
    if (this.form.pin && this.form.pin.length < 4) { this.formError = 'PIN must be at least 4 digits'; return; }
    if (this.form.pin && this.form.pin !== this.form.confirmPin) { this.formError = 'PINs do not match'; return; }
    this.saving = true;
    try {
      if (this.editingId) {
        const payload: any = { name: this.form.name, role: this.form.role };
        if (this.form.pin) payload.pin = this.form.pin;
        await this.api.update(this.editingId, payload);
      } else {
        await this.api.create({ name: this.form.name, role: this.form.role, pin: this.form.pin });
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

  async deactivate(s: Staff): Promise<void> {
    if (!confirm(`Deactivate ${s.name}?`)) return;
    try {
      await this.api.deactivate(s.id);
      await this.load();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async reactivate(s: Staff): Promise<void> {
    try {
      await this.api.update(s.id, { is_active: true });
      await this.load();
    } catch (e: any) {
      alert(e.message);
    }
  }
}
