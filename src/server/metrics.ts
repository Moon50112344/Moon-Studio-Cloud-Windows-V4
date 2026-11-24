import os from 'node:os';
import { vmManager } from './vmManager';
import { hostResourceManager } from './resourceManager';

export interface MetricSample {
  time: string;
  cpu: number;
  memory: number;
  memoryMb: number;
  totalMemoryMb: number;
}

export interface VmMetricsResponse {
  success: boolean;
  vmId: string;
  vmName: string;
  cores: number;
  cpuPercent: number;
  memoryMb: number;
  totalMemoryMb: number;
  memoryPercent: number;
  uptimeSeconds: number;
  timestamp: string;
  history: MetricSample[];
}

export class VmMetricsCollector {
  private historyMap: Map<string, MetricSample[]> = new Map();
  private maxHistory = 20;

  constructor() {
    this.seedInitialHistory();
  }

  private getCpuUsage(): number {
    const pct = hostResourceManager.getRealCpuUsagePercent();
    return Math.min(100, Math.max(0, Math.round(pct * 10) / 10));
  }

  private seedInitialHistory(): void {
    const now = Date.now();
    const defaultHistory: MetricSample[] = [];

    const totalMem = Math.round(os.totalmem() / 1024 / 1024);
    const freeMem = Math.round(os.freemem() / 1024 / 1024);
    const baseUsed = Math.max(200, totalMem - freeMem);
    const baseMemPct = Math.min(95, Math.round((baseUsed / totalMem) * 100));

    // Generate 12 baseline points
    for (let i = 12; i >= 1; i--) {
      const pointTime = new Date(now - i * 3000);
      const timeStr = pointTime.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const jitter = (Math.sin(i) * 3);
      const cpu = Math.max(2, Math.min(95, Math.round(8 + jitter)));
      const memory = Math.max(10, Math.min(95, Math.round(baseMemPct + (jitter * 0.5))));
      const memoryMb = Math.round((memory / 100) * 2048);

      defaultHistory.push({
        time: timeStr,
        cpu,
        memory,
        memoryMb,
        totalMemoryMb: 2048,
      });
    }

    this.historyMap.set('default', defaultHistory);
  }

  public getMetrics(vmId?: string): VmMetricsResponse {
    const allVms = vmManager.getAllVms();
    const targetVm = vmId ? vmManager.getVm(vmId) : (vmManager.getPrimaryVm() || allVms[0]);

    const currentVmId = vmId || (targetVm ? targetVm.id : 'vm-default');
    const vmName = targetVm ? targetVm.name : (vmId ? `VM ${vmId}` : 'Cloud VM Instance');
    const cores = targetVm ? targetVm.cores : 2;
    const targetTotalMemMb = targetVm ? targetVm.memoryMb : 2048;

    // Real system memory calculation
    const hostTotalMem = Math.round(os.totalmem() / 1024 / 1024);
    const hostFreeMem = Math.round(os.freemem() / 1024 / 1024);
    const hostUsedMem = Math.max(150, hostTotalMem - hostFreeMem);
    const hostMemRatio = hostUsedMem / hostTotalMem;

    // Scale to VM's allocated RAM
    const memoryMb = Math.min(targetTotalMemMb, Math.max(120, Math.round(targetTotalMemMb * hostMemRatio)));
    const memoryPercent = Math.min(100, Math.max(5, Math.round((memoryMb / targetTotalMemMb) * 100)));

    const cpuPercent = this.getCpuUsage();
    const nowTimeStr = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let history = this.historyMap.get(currentVmId);
    if (!history || history.length === 0) {
      history = [...(this.historyMap.get('default') || [])];
    }

    const newSample: MetricSample = {
      time: nowTimeStr,
      cpu: cpuPercent,
      memory: memoryPercent,
      memoryMb,
      totalMemoryMb: targetTotalMemMb,
    };

    history.push(newSample);
    if (history.length > this.maxHistory) {
      history = history.slice(-this.maxHistory);
    }
    this.historyMap.set(currentVmId, history);

    return {
      success: true,
      vmId: currentVmId,
      vmName,
      cores,
      cpuPercent,
      memoryMb,
      totalMemoryMb: targetTotalMemMb,
      memoryPercent,
      uptimeSeconds: Math.round(os.uptime()),
      timestamp: new Date().toISOString(),
      history,
    };
  }
}

export const vmMetricsCollector = new VmMetricsCollector();
