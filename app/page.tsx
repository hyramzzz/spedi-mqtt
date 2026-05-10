'use client';

import { useState } from 'react';
import { TelemetryPanel } from './components/telemetry-panel';
import { SystemActivity } from './components/system-activity';
import { CameraSnapshot } from './components/camera-snapshot';
import { LiveMap } from './components/live-map';

type PanelView = 'NAV_VIEW' | 'SYSTEM_ACTIVITY';

export default function Home() {
  const [activePanel, setActivePanel] = useState<PanelView>('NAV_VIEW');

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-4 h-full xl:h-screen overflow-hidden">
      <div className="border-b border-border pb-4 flex items-end justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold tracking-widest uppercase font-sans text-foreground">Mission_Control //</h1>
          <p className="text-[10px] text-muted-foreground mt-1 uppercase font-sans tracking-widest">Real-time status and system intelligence</p>
        </div>
        <div className="text-[10px] text-foreground font-mono uppercase tracking-widest bg-muted px-2 py-1 rounded-sm border mb-1">
          SYS_STAT: [ONLINE]
        </div>
      </div>

      <div className="flex flex-col flex-1 h-full overflow-y-auto xl:overflow-hidden gap-6 pb-6">
        {/* Real-time Status */}
        <div className="shrink-0 flex flex-col gap-2">
          <h2 className="text-[10px] font-bold tracking-widest uppercase font-sans text-muted-foreground ml-1">Live_Telemetry_Stream</h2>
          <TelemetryPanel />
        </div>

        {/* Intelligence Grid */}
        <div className="flex flex-col xl:flex-row gap-6 flex-1 xl:min-h-0">

          {/* Left Panel: Toggle between NAV_VIEW and SYSTEM_ACTIVITY */}
          <div className="flex flex-col gap-0 flex-1 min-h-[400px] xl:min-h-0">
            {/* Panel Toggle Tabs */}
            <div className="flex items-center gap-0 shrink-0">
              <button
                onClick={() => setActivePanel('NAV_VIEW')}
                className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest font-sans border border-border rounded-tl-sm transition-colors ${
                  activePanel === 'NAV_VIEW'
                    ? 'bg-background text-foreground border-b-transparent'
                    : 'bg-muted/30 text-muted-foreground hover:text-foreground border-b-border'
                }`}
              >
                Nav_View
              </button>
              <button
                onClick={() => setActivePanel('SYSTEM_ACTIVITY')}
                className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest font-sans border border-border border-l-0 rounded-tr-sm transition-colors ${
                  activePanel === 'SYSTEM_ACTIVITY'
                    ? 'bg-background text-foreground border-b-transparent'
                    : 'bg-muted/30 text-muted-foreground hover:text-foreground border-b-border'
                }`}
              >
                System_Activity
              </button>
              {/* Filler border to complete the tab bar */}
              <div className="flex-1 border-b border-border" />
            </div>

            {/* Panel Content — both panels stay mounted to preserve SSE subscriptions and state */}
            <div className="flex-1 min-h-0 border border-border border-t-0 rounded-b-sm overflow-hidden bg-background relative">
              <div className={`absolute inset-0 ${activePanel === 'NAV_VIEW' ? '' : 'hidden'}`}>
                <LiveMap isVisible={activePanel === 'NAV_VIEW'} />
              </div>
              <div className={`h-full ${activePanel === 'SYSTEM_ACTIVITY' ? '' : 'hidden'}`}>
                <SystemActivity />
              </div>
            </div>
          </div>

          {/* Camera Snapshot */}
          <div className="flex flex-col gap-2 xl:w-96 shrink-0 min-h-[300px] xl:min-h-0">
            <h2 className="text-[10px] font-bold tracking-widest uppercase font-sans text-muted-foreground ml-1">Remote_Vision</h2>
            <div className="flex-1 min-h-0">
              <CameraSnapshot />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
