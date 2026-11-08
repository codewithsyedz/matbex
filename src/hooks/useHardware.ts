import { useEffect, useState, useCallback } from "react";
import {
  hardwareManager,
  PRINT_QUEUE_EVENT,
  HARDWARE_CONFIG_EVENT,
  type HardwareConfig,
  type PrintJob,
  type PrinterDescriptor,
} from "@/lib/hardware";

let installed = false;
function ensureInstalled() {
  if (installed) return;
  installed = true;
  hardwareManager.install();
}

export function useHardwareConfig() {
  ensureInstalled();
  const [config, setConfig] = useState<HardwareConfig>(() => hardwareManager.getConfig());

  useEffect(() => {
    const onChange = () => setConfig(hardwareManager.getConfig());
    window.addEventListener(HARDWARE_CONFIG_EVENT, onChange);
    return () => window.removeEventListener(HARDWARE_CONFIG_EVENT, onChange);
  }, []);

  const update = useCallback((patch: Partial<HardwareConfig>) => {
    hardwareManager.updateConfig(patch);
  }, []);

  return { config, updateConfig: update };
}

export function usePrintQueue() {
  ensureInstalled();
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);

  const refresh = useCallback(async () => {
    setJobs(await hardwareManager.getQueue());
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener(PRINT_QUEUE_EVENT, onChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener(PRINT_QUEUE_EVENT, onChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh]);

  return {
    jobs,
    online,
    pending: jobs.filter((j) => j.status === "pending" || j.status === "queued-offline").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    retry: (id: string) => hardwareManager.retryJob(id),
    drain: () => hardwareManager.drainQueue(),
    refresh,
  };
}

export function useHardwareStatus() {
  ensureInstalled();
  const [printers, setPrinters] = useState<PrinterDescriptor[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(async () => {
    setDetecting(true);
    setError(null);
    try {
      setPrinters(await hardwareManager.detectPrinters());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detection failed");
      setPrinters([]);
    } finally {
      setDetecting(false);
    }
  }, []);

  return { printers, detecting, error, detect };
}