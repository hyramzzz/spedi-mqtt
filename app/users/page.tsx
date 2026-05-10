'use client';

import { useEffect, useState } from 'react';
import { RiLoader4Line, RiDeleteBinLine, RiAddLine, RiUserLine, RiEdit2Line, RiShieldUserLine, RiUserStarLine } from "@remixicon/react";
import { apiFetch } from '@/lib/api';
import { Modal } from '@/app/components/modal';

interface User {
    id: string;
    email: string;
    is_superuser: boolean;
    created_at: string;
}

export default function UsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    // Modals
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);

    // Form
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [formSaving, setFormSaving] = useState(false);
    const [formError, setFormError] = useState('');

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const res = await apiFetch('/users');
            if (res.ok) setUsers(await res.json());
        } catch (err) {
            console.error('Failed to load users:', err);
        } finally {
            setLoading(false);
        }
    };

    const openAdd = () => {
        setFormError('');
        setFormData({ email: '', password: '' });
        setIsAddOpen(true);
    };

    const openEdit = (u: User) => {
        setFormError('');
        setSelectedUser(u);
        setFormData({ email: u.email, password: '' }); // Password blank for edit unless changed
        setIsEditOpen(true);
    };

    const openDelete = (u: User) => {
        setFormError('');
        setSelectedUser(u);
        setIsDeleteOpen(true);
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormSaving(true);
        setFormError('');
        try {
            const res = await apiFetch('/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            const newUser = await res.json();
            setUsers(prev => [...prev, newUser]);
            setIsAddOpen(false);
        } catch (err: any) {
            setFormError(err.message);
        } finally {
            setFormSaving(false);
        }
    };

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedUser) return;
        setFormSaving(true);
        setFormError('');

        // Only include non-empty values
        const updateBody: any = { email: formData.email };
        if (formData.password) updateBody.password = formData.password;

        try {
            const res = await apiFetch(`/users/${selectedUser.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updateBody),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `HTTP ${res.status}`);
            }

            // Refresh list to show updates
            await fetchUsers();
            setIsEditOpen(false);
        } catch (err: any) {
            setFormError(err.message);
        } finally {
            setFormSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedUser) return;
        setFormSaving(true);
        setFormError('');
        try {
            const res = await apiFetch(`/users/${selectedUser.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            setUsers(prev => prev.filter(u => u.id !== selectedUser.id));
            setIsDeleteOpen(false);
        } catch (err: any) {
            setFormError(err.message);
        } finally {
            setFormSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="p-4 lg:p-6 flex items-center justify-center h-full text-muted-foreground">
                <RiLoader4Line className="animate-spin" size={24} />
            </div>
        );
    }

    return (
        <div className="p-4 lg:p-6 flex flex-col gap-4 h-full">
            <div className="border-b border-border pb-4 flex items-end justify-between">
                <div>
                    <h1 className="text-lg font-bold tracking-widest uppercase font-sans text-foreground">User_Management //</h1>
                    <p className="text-[10px] text-muted-foreground mt-1 uppercase font-sans tracking-widest">Administrative control of system authentication accounts</p>
                </div>
            </div>

            <div className="flex flex-col gap-4 flex-1">
                <div className="rounded-sm border border-border bg-background p-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div>
                        <h2 className="text-xs font-bold tracking-widest uppercase font-sans text-foreground mb-1">Security Policy</h2>
                        <p className="text-[10px] text-muted-foreground font-sans uppercase tracking-widest max-w-xl">
                            All users created via this interface are STANDARD accounts. Superuser status can only be provisioned through direct database seeding or manual backend configuration for enhanced security.
                        </p>
                    </div>
                    <button
                        onClick={openAdd}
                        className="inline-flex shrink-0 items-center justify-center min-w-[140px] gap-2 bg-foreground hover:bg-muted-foreground text-background font-bold px-4 py-2 rounded-sm transition-colors text-[10px] uppercase tracking-widest font-sans"
                    >
                        <RiAddLine size={14} />
                        Create User
                    </button>
                </div>

                <div className="rounded-sm border border-border bg-background overflow-hidden flex-1 flex flex-col">
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left">
                            <thead className="bg-muted/30">
                                <tr className="border-b border-border text-foreground font-sans uppercase tracking-widest text-[10px]">
                                    <th className="px-4 py-3 font-bold">Account / Email</th>
                                    <th className="px-4 py-3 font-bold hidden md:table-cell">Internal ID</th>
                                    <th className="px-4 py-3 font-bold text-center">Type</th>
                                    <th className="px-4 py-3 font-bold text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {users.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground uppercase tracking-widest text-[10px] font-sans">
                                            <div className="flex flex-col items-center justify-center opacity-50">
                                                <RiUserLine size={24} className="mb-2" />
                                                No secondary users found
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    users.map((u) => (
                                        <tr key={u.id} className="hover:bg-muted/50 transition-colors group">
                                            <td className="px-4 py-3 font-bold text-foreground">
                                                <div className="flex flex-col">
                                                    <span>{u.email}</span>
                                                    <span className="text-[9px] font-normal text-muted-foreground uppercase tracking-widest md:hidden mt-0.5">
                                                        ID: {u.id}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground font-mono hidden md:table-cell">
                                                {u.id}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {u.is_superuser ? (
                                                    <span className="inline-flex items-center gap-1 bg-foreground text-background px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-widest">
                                                        <RiUserStarLine size={10} />
                                                        Super
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 bg-muted text-muted-foreground px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-widest border border-border">
                                                        <RiUserLine size={10} />
                                                        Std
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => openEdit(u)}
                                                        disabled={u.is_superuser && u.email !== formData.email} // Simplified check, mainly to emphasize lack of superuser edit
                                                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors text-[10px] uppercase tracking-widest font-sans bg-background border border-border px-2 py-1 rounded-sm hover:border-foreground disabled:opacity-30 disabled:pointer-events-none"
                                                    >
                                                        <RiEdit2Line size={12} />
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => openDelete(u)}
                                                        disabled={u.is_superuser}
                                                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-red-500 transition-colors text-[10px] uppercase tracking-widest font-sans bg-background border border-border px-2 py-1 rounded-sm hover:border-red-500 disabled:opacity-30 disabled:pointer-events-none"
                                                    >
                                                        <RiDeleteBinLine size={12} />
                                                        Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* modals */}
            <Modal isOpen={isAddOpen} onClose={() => !formSaving && setIsAddOpen(false)} title="Create Standard Account">
                <form onSubmit={handleAdd} className="flex flex-col gap-4">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">
                        Provision a new user account with documentation-level access.
                    </p>

                    {formError && (
                        <div className="text-red-500 border border-red-500/50 bg-red-500/10 p-2 text-[10px] uppercase tracking-widest font-bold">
                            Error: {formError}
                        </div>
                    )}

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-foreground">Email Address</label>
                        <input
                            type="email"
                            required
                            autoFocus
                            placeholder="user@example.com"
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            className="bg-background border border-border focus:border-foreground rounded-sm px-3 py-2 text-sm focus:outline-none transition-colors font-mono"
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-foreground">Password</label>
                        <input
                            type="password"
                            required
                            placeholder="min 6 characters"
                            value={formData.password}
                            onChange={e => setFormData({ ...formData, password: e.target.value })}
                            className="bg-background border border-border focus:border-foreground rounded-sm px-3 py-2 text-sm focus:outline-none transition-colors font-mono"
                        />
                    </div>

                    <div className="flex justify-end gap-2 mt-2">
                        <button
                            type="button"
                            onClick={() => setIsAddOpen(false)}
                            disabled={formSaving}
                            className="px-4 py-2 border border-border hover:bg-muted/50 rounded-sm text-[10px] uppercase tracking-widest font-bold transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={formSaving}
                            className="px-4 py-2 bg-foreground text-background hover:bg-muted-foreground rounded-sm text-[10px] uppercase tracking-widest font-bold transition-colors inline-flex items-center gap-2 min-w-[100px] justify-center"
                        >
                            {formSaving ? <RiLoader4Line className="animate-spin" size={14} /> : 'Create User'}
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal isOpen={isEditOpen} onClose={() => !formSaving && setIsEditOpen(false)} title="Update User Info">
                <form onSubmit={handleEdit} className="flex flex-col gap-4">
                    {formError && (
                        <div className="text-red-500 border border-red-500/50 bg-red-500/10 p-2 text-[10px] uppercase tracking-widest font-bold">
                            Error: {formError}
                        </div>
                    )}

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-foreground">Email Address</label>
                        <input
                            type="email"
                            required
                            autoFocus
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            className="bg-background border border-border focus:border-foreground rounded-sm px-3 py-2 text-sm focus:outline-none transition-colors font-mono"
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-foreground">New Password</label>
                        <input
                            type="password"
                            placeholder="Leave blank to keep current"
                            value={formData.password}
                            onChange={e => setFormData({ ...formData, password: e.target.value })}
                            className="bg-background border border-border focus:border-foreground rounded-sm px-3 py-2 text-sm focus:outline-none transition-colors font-mono"
                        />
                    </div>

                    <div className="flex justify-end gap-2 mt-2">
                        <button
                            type="button"
                            onClick={() => setIsEditOpen(false)}
                            disabled={formSaving}
                            className="px-4 py-2 border border-border hover:bg-muted/50 rounded-sm text-[10px] uppercase tracking-widest font-bold transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={formSaving}
                            className="px-4 py-2 bg-foreground text-background hover:bg-muted-foreground rounded-sm text-[10px] uppercase tracking-widest font-bold transition-colors inline-flex items-center gap-2 min-w-[100px] justify-center"
                        >
                            {formSaving ? <RiLoader4Line className="animate-spin" size={14} /> : 'Update Account'}
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal isOpen={isDeleteOpen} onClose={() => !formSaving && setIsDeleteOpen(false)} title="Confirm Account Removal">
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-foreground">
                        Are you sure you want to permanently delete the account for <span className="font-bold">{selectedUser?.email}</span>?
                    </p>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">
                        This user will lose all access to the system immediately. This action cannot be undone.
                    </p>

                    {formError && (
                        <div className="text-red-500 border border-red-500/50 bg-red-500/10 p-2 text-[10px] uppercase tracking-widest font-bold">
                            Error: {formError}
                        </div>
                    )}

                    <div className="flex justify-end gap-2 mt-2">
                        <button
                            type="button"
                            onClick={() => setIsDeleteOpen(false)}
                            disabled={formSaving}
                            className="px-4 py-2 border border-border hover:bg-muted/50 rounded-sm text-[10px] uppercase tracking-widest font-bold transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleDelete}
                            disabled={formSaving}
                            className="px-4 py-2 bg-red-500 text-white hover:bg-red-600 rounded-sm text-[10px] uppercase tracking-widest font-bold transition-colors inline-flex items-center gap-2 min-w-[100px] justify-center"
                        >
                            {formSaving ? <RiLoader4Line className="animate-spin" size={14} /> : 'Delete User'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
