'use client';

import { useEffect, useState } from 'react';
import { RiLoader4Line, RiDeleteBinLine, RiAddLine, RiServerLine, RiEdit2Line } from "@remixicon/react";
import { apiFetch } from '@/lib/api';
import { Modal } from '@/app/components/modal';

interface Device {
    id: string;
    name: string;
    mqtt_client_id: string;
    last_seen_at: string | null;
}

export default function DevicesPage() {
    const [devices, setDevices] = useState<Device[]>([]);
    const [loading, setLoading] = useState(true);

    // Modals
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

    // Form
    const [formData, setFormData] = useState({ name: '', mqtt_client_id: '' });
    const [formSaving, setFormSaving] = useState(false);
    const [formError, setFormError] = useState('');

    useEffect(() => {
        fetchDevices();
    }, []);

    const fetchDevices = async () => {
        try {
            const devRes = await apiFetch('/devices');
            if (devRes.ok) setDevices(await devRes.json());
        } catch (err) {
            console.error('Failed to load devices:', err);
        } finally {
            setLoading(false);
        }
    };

    const openAdd = () => {
        setFormError('');
        setFormData({ name: '', mqtt_client_id: '' });
        setIsAddOpen(true);
    };

    const openEdit = (d: Device) => {
        setFormError('');
        setSelectedDevice(d);
        setFormData({ name: d.name, mqtt_client_id: d.mqtt_client_id });
        setIsEditOpen(true);
    };

    const openDelete = (d: Device) => {
        setFormError('');
        setSelectedDevice(d);
        setIsDeleteOpen(true);
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormSaving(true);
        setFormError('');
        try {
            const res = await apiFetch('/devices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            const newDevice = await res.json();
            setDevices(prev => [...prev, newDevice]);
            setIsAddOpen(false);
        } catch (err: any) {
            setFormError(err.message);
        } finally {
            setFormSaving(false);
        }
    };

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedDevice) return;
        setFormSaving(true);
        setFormError('');
        try {
            const res = await apiFetch(`/devices/${selectedDevice.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            const updatedDevice = await res.json();
            setDevices(prev => prev.map(d => d.id === updatedDevice.id ? updatedDevice : d));
            setIsEditOpen(false);
        } catch (err: any) {
            setFormError(err.message);
        } finally {
            setFormSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedDevice) return;
        setFormSaving(true);
        setFormError('');
        try {
            const res = await apiFetch(`/devices/${selectedDevice.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            setDevices(prev => prev.filter(d => d.id !== selectedDevice.id));
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
                    <h1 className="text-lg font-bold tracking-widest uppercase font-sans text-foreground">Device_Management //</h1>
                    <p className="text-[10px] text-muted-foreground mt-1 uppercase font-sans tracking-widest">Provision and manage registered hardware units</p>
                </div>
            </div>

            <div className="flex flex-col gap-4 flex-1">
                <div className="rounded-sm border border-border bg-background p-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div>
                        <h2 className="text-xs font-bold tracking-widest uppercase font-sans text-foreground mb-1">Registration Policy</h2>
                        <p className="text-[10px] text-muted-foreground font-sans uppercase tracking-widest max-w-xl">
                            Devices DO NOT auto-register upon MQTT connection. To prevent unauthorized access, you must manually provision standard network hardware by defining a friendly name and their corresponding MQTT Client ID below.
                        </p>
                    </div>
                    <button
                        onClick={openAdd}
                        className="inline-flex shrink-0 items-center justify-center min-w-[140px] gap-2 bg-foreground hover:bg-muted-foreground text-background font-bold px-4 py-2 rounded-sm transition-colors text-[10px] uppercase tracking-widest font-sans"
                    >
                        <RiAddLine size={14} />
                        Add Device
                    </button>
                </div>

                <div className="rounded-sm border border-border bg-background overflow-hidden flex-1 flex flex-col">
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left">
                            <thead className="bg-muted/30">
                                <tr className="border-b border-border text-foreground font-sans uppercase tracking-widest text-[10px]">
                                    <th className="px-4 py-3 font-bold">Device Name</th>
                                    <th className="px-4 py-3 font-bold hidden md:table-cell">Device ID</th>
                                    <th className="px-4 py-3 font-bold hidden sm:table-cell">MQTT Client ID</th>
                                    <th className="px-4 py-3 font-bold text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {devices.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground uppercase tracking-widest text-[10px] font-sans">
                                            <div className="flex flex-col items-center justify-center opacity-50">
                                                <RiServerLine size={24} className="mb-2" />
                                                No devices registered in the system
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    devices.map((d) => (
                                        <tr key={d.id} className="hover:bg-muted/50 transition-colors group">
                                            <td className="px-4 py-3 font-bold text-foreground">
                                                {d.name}
                                                <div className="text-[9px] font-normal text-muted-foreground mt-0.5 md:hidden">
                                                    ID: {d.id}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground font-mono hidden md:table-cell">
                                                {d.id}
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground font-mono hidden sm:table-cell">
                                                {d.mqtt_client_id}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => openEdit(d)}
                                                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors text-[10px] uppercase tracking-widest font-sans bg-background border border-border px-2 py-1 rounded-sm hover:border-foreground"
                                                    >
                                                        <RiEdit2Line size={12} />
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => openDelete(d)}
                                                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-red-500 transition-colors text-[10px] uppercase tracking-widest font-sans bg-background border border-border px-2 py-1 rounded-sm hover:border-red-500"
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
            <Modal isOpen={isAddOpen} onClose={() => !formSaving && setIsAddOpen(false)} title="Add New Device">
                <form onSubmit={handleAdd} className="flex flex-col gap-4">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">
                        Register a new hardware endpoint. The MQTT Client ID must match the ID the device uses when connecting to the broker.
                    </p>

                    {formError && (
                        <div className="text-red-500 border border-red-500/50 bg-red-500/10 p-2 text-[10px] uppercase tracking-widest font-bold">
                            Error: {formError}
                        </div>
                    )}

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-foreground">Friendly Name</label>
                        <input
                            required
                            autoFocus
                            placeholder="e.g. Patrol Boat Alpha"
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            className="bg-background border border-border focus:border-foreground rounded-sm px-3 py-2 text-sm focus:outline-none transition-colors"
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-foreground">MQTT Client ID</label>
                        <input
                            required
                            placeholder="e.g. spedi-device-01"
                            value={formData.mqtt_client_id}
                            onChange={e => setFormData({ ...formData, mqtt_client_id: e.target.value })}
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
                            {formSaving ? <RiLoader4Line className="animate-spin" size={14} /> : 'Register'}
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal isOpen={isEditOpen} onClose={() => !formSaving && setIsEditOpen(false)} title="Edit Device">
                <form onSubmit={handleEdit} className="flex flex-col gap-4">
                    {formError && (
                        <div className="text-red-500 border border-red-500/50 bg-red-500/10 p-2 text-[10px] uppercase tracking-widest font-bold">
                            Error: {formError}
                        </div>
                    )}

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-foreground">Friendly Name</label>
                        <input
                            required
                            autoFocus
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            className="bg-background border border-border focus:border-foreground rounded-sm px-3 py-2 text-sm focus:outline-none transition-colors"
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-foreground">MQTT Client ID</label>
                        <input
                            required
                            value={formData.mqtt_client_id}
                            onChange={e => setFormData({ ...formData, mqtt_client_id: e.target.value })}
                            className="bg-background border border-border focus:border-foreground rounded-sm px-3 py-2 text-sm focus:outline-none transition-colors font-mono"
                        />
                        <p className="text-[9px] text-muted-foreground mt-1 font-sans uppercase tracking-widest">
                            Warning: changing the Client ID may sever connection with the physical device if it isn't also updated elsewhere.
                        </p>
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
                            {formSaving ? <RiLoader4Line className="animate-spin" size={14} /> : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal isOpen={isDeleteOpen} onClose={() => !formSaving && setIsDeleteOpen(false)} title="Confirm Deletion">
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-foreground">
                        Are you sure you want to delete <span className="font-bold">{selectedDevice?.name}</span>?
                    </p>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">
                        This action cannot be undone. Associated telemetry and saved routes will also be permanently deleted.
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
                            {formSaving ? <RiLoader4Line className="animate-spin" size={14} /> : 'Delete Device'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
