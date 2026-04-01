import { create } from 'zustand'

export interface DeviceCapabilities {
  microphone: boolean
  camera: boolean
  gps: boolean
  bluetooth: boolean
  nfc: boolean
  files: { read: string; write: string } | false
  sensors: string[]
  notifications: boolean
}

export interface Device {
  id: string
  name: string
  platform: 'linux' | 'windows' | 'android' | 'macos' | 'raspberry_pi'
  ip: string
  status: 'online' | 'offline' | 'connecting'
  lastSeen: string
  capabilities: Partial<DeviceCapabilities>
  accessLevel: 'read-only' | 'standard' | 'full' | 'custom'
}

interface DeviceState {
  devices: Device[]
  setDevices: (devices: Device[]) => void
  updateDevice: (id: string, updates: Partial<Device>) => void
  toggleCapability: (deviceId: string, capability: keyof DeviceCapabilities) => void
}

export const useDeviceStore = create<DeviceState>((set) => ({
  devices: [],

  setDevices: (devices) => set({ devices }),

  updateDevice: (id, updates) =>
    set((s) => ({
      devices: s.devices.map((d) => (d.id === id ? { ...d, ...updates } : d)),
    })),

  toggleCapability: (deviceId, capability) =>
    set((s) => ({
      devices: s.devices.map((d) =>
        d.id === deviceId
          ? {
              ...d,
              capabilities: {
                ...d.capabilities,
                [capability]: !d.capabilities[capability],
              },
            }
          : d
      ),
    })),
}))
