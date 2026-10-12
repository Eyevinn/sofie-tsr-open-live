import type { DeviceEntry } from 'timeline-state-resolver-api'
import { OpenLiveDevice } from './device'
import { OpenLiveDeviceType, type OpenLiveOptions } from './types'

export * from './types'

export const Devices: Record<string, DeviceEntry> = {
	[OpenLiveDeviceType]: {
		deviceClass: OpenLiveDevice,
		canConnect: true,
		deviceName: (deviceId: string, options: OpenLiveOptions) =>
			`Open Live ${options?.productionId ?? ''} ${deviceId}`.replace(/\s+/g, ' ').trim(),
		// Order matters (clip cue before cut, program before preview).
		executionMode: () => 'sequential',
	},
}
