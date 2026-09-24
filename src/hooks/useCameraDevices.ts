import { useEffect, useState } from 'react';

export function useCameraDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Device labels are only populated after permission is granted,
        // so request a throwaway stream first.
        const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
        tmp.getTracks().forEach((t) => t.stop());
      } catch {
        // permission denied or no camera; enumerateDevices will just return unlabeled entries
      }
      const all = await navigator.mediaDevices.enumerateDevices();
      if (!cancelled) {
        setDevices(all.filter((d) => d.kind === 'videoinput'));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return devices;
}
