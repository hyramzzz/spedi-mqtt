'use client';

import React, { useEffect, useRef } from 'react';
import { RiCloseLine } from '@remixicon/react';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
    const overlayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'hidden';
        }

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === overlayRef.current) {
            onClose();
        }
    };

    return (
        <div
            ref={overlayRef}
            onClick={handleOverlayClick}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
        >
            <div className="w-full max-w-md bg-background border border-foreground rounded-sm flex flex-col shadow-2xl crt-terminal">
                <div className="scanline"></div>
                <div className="flex items-center justify-between p-3 border-b border-border">
                    <h2 className="text-[10px] uppercase tracking-widest font-sans font-bold text-foreground">
                        {title}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-muted-foreground hover:text-foreground hover:bg-muted/50 p-1 rounded-sm transition-colors"
                        title="Close (Esc)"
                    >
                        <RiCloseLine size={16} />
                    </button>
                </div>
                <div className="p-4">
                    {children}
                </div>
            </div>
        </div>
    );
}
