import type { DeviceTimelineState, Mappings } from 'timeline-state-resolver-types'
import { convertTimelineStateToDeviceState, diffStates, emptyState } from '../state'
import { MappingOpenLiveType, OpenLiveDeviceType, TimelineContentTypeOpenLive } from '../types'

const mapping = (options: Record<string, unknown>) => ({ device: OpenLiveDeviceType, deviceId: 'ol0', options })

const mappings = {
	ol_pgm: mapping({ mappingType: MappingOpenLiveType.Program }),
	ol_pvw: mapping({ mappingType: MappingOpenLiveType.Preview }),
	ol_dsk0: mapping({ mappingType: MappingOpenLiveType.Dsk, layer: 0 }),
	ol_gfx_l3: mapping({ mappingType: MappingOpenLiveType.Graphic, overlayId: 'lower-third' }),
	ol_audio_ch1: mapping({ mappingType: MappingOpenLiveType.Audio, elementId: 'ch1' }),
	ol_clip: mapping({ mappingType: MappingOpenLiveType.Clip, mixerInput: 'video_in_5' }),
	ol_air: mapping({ mappingType: MappingOpenLiveType.OnAir }),
	ol_ftb: mapping({ mappingType: MappingOpenLiveType.Ftb }),
	atem_me: { device: 'ATEM', deviceId: 'atem0', options: { mappingType: 'mixEffect', index: 0 } },
} as unknown as Mappings

function tl(...objs: Array<[layer: string, id: string, content: Record<string, unknown>]>): DeviceTimelineState {
	return {
		time: 1000,
		objects: objs.map(([layer, id, content]) => ({
			id,
			layer,
			priority: 0,
			content: { deviceType: OpenLiveDeviceType, ...content },
			instance: { id: id + '_i', start: 0, end: null },
		})),
	} as unknown as DeviceTimelineState
}

const frames = (oldTl: DeviceTimelineState | undefined, newTl: DeviceTimelineState) =>
	diffStates(
		oldTl ? convertTimelineStateToDeviceState(oldTl, mappings) : undefined,
		convertTimelineStateToDeviceState(newTl, mappings)
	).map((c) => c.command)

describe('convert + diff', () => {
	test('empty timeline turns mapped keyers off and leaves the rest alone', () => {
		const s = convertTimelineStateToDeviceState(tl(), mappings)
		expect(s.program).toBeUndefined()
		expect(s.dsk).toEqual({ 0: { visible: false, objId: '' } })
		expect(s.graphics).toEqual({ 'lower-third': { active: false, objId: '' } })
		expect(s.audio).toEqual({})
		expect(frames(undefined, tl())).toEqual([])
	})

	test('program cut, then fade to a new input', () => {
		const a = tl(['ol_pgm', 'cam1', { type: TimelineContentTypeOpenLive.Program, input: 'video_in_1' }])
		expect(frames(undefined, a)).toEqual([{ type: 'CUT', mixerInput: 'video_in_1' }])

		const b = tl([
			'ol_pgm',
			'cam2',
			{ type: TimelineContentTypeOpenLive.Program, input: 'video_in_2', transition: { type: 'fade', durationMs: 500 } },
		])
		expect(frames(a, b)).toEqual([{ type: 'TRANSITION', mixerInput: 'video_in_2', transitionType: 'fade', durationMs: 500 }])
	})

	test('same input on a new object sends nothing', () => {
		const a = tl(['ol_pgm', 'cam1', { type: TimelineContentTypeOpenLive.Program, input: 'video_in_1' }])
		const b = tl(['ol_pgm', 'cam1b', { type: TimelineContentTypeOpenLive.Program, input: 'video_in_1' }])
		expect(frames(a, b)).toEqual([])
	})

	test('program before preview', () => {
		const s = tl(
			['ol_pvw', 'la', { type: TimelineContentTypeOpenLive.Preview, input: 'video_in_3' }],
			['ol_pgm', 'cam1', { type: TimelineContentTypeOpenLive.Program, input: 'video_in_1' }]
		)
		expect(frames(undefined, s).map((f) => f.type)).toEqual(['CUT', 'SET_PVW'])
	})

	test('dsk and graphics follow object presence', () => {
		const on = tl(
			['ol_dsk0', 'k', { type: TimelineContentTypeOpenLive.Dsk }],
			['ol_gfx_l3', 'g', { type: TimelineContentTypeOpenLive.Graphic }]
		)
		expect(frames(tl(), on)).toEqual([
			{ type: 'DSK_TOGGLE', layer: 0, visible: true },
			{ type: 'GRAPHIC_ON', overlayId: 'lower-third' },
		])
		expect(frames(on, tl())).toEqual([
			{ type: 'DSK_TOGGLE', layer: 0, visible: false },
			{ type: 'GRAPHIC_OFF', overlayId: 'lower-third' },
		])
	})

	test('clip is cued and played before the cut, stopped when it ends', () => {
		const vt = tl(
			['ol_clip', 'vt1', { type: TimelineContentTypeOpenLive.Clip, clipId: 'story-42' }],
			['ol_pgm', 'pgm_vt', { type: TimelineContentTypeOpenLive.Program, input: 'video_in_5' }]
		)
		expect(frames(tl(), vt)).toEqual([
			{ type: 'CLIP_CUE', mixerInput: 'video_in_5', clipId: 'story-42' },
			{ type: 'CLIP_PLAY', mixerInput: 'video_in_5' },
			{ type: 'CUT', mixerInput: 'video_in_5' },
		])
		const back = tl(['ol_pgm', 'cam1', { type: TimelineContentTypeOpenLive.Program, input: 'video_in_1' }])
		expect(frames(vt, back)).toEqual([
			{ type: 'CLIP_STOP', mixerInput: 'video_in_5' },
			{ type: 'CUT', mixerInput: 'video_in_1' },
		])
	})

	test('a clip reported by the device on reconnect is not re-rolled', () => {
		const device = emptyState()
		device.clips['video_in_5'] = { objId: '', active: true, clipId: 'story-42', playing: true }
		const next = convertTimelineStateToDeviceState(
			tl(['ol_clip', 'vt1', { type: TimelineContentTypeOpenLive.Clip, clipId: 'story-42' }]),
			mappings
		)
		expect(diffStates(device, next)).toEqual([])
	})

	test('audio only sends what the object sets', () => {
		const s = tl(['ol_audio_ch1', 'a', { type: TimelineContentTypeOpenLive.Audio, volume: 0.5, rampMs: 200 }])
		expect(frames(undefined, s)).toEqual([{ type: 'AUDIO_SET', elementId: 'ch1', property: 'volume', value: 0.5, ramp_ms: 200 }])
		expect(frames(s, tl())).toEqual([])
	})

	test('on-air is explicit, ftb follows presence', () => {
		const s = tl(
			['ol_air', 'air', { type: TimelineContentTypeOpenLive.OnAir, onAir: true }],
			['ol_ftb', 'ftb', { type: TimelineContentTypeOpenLive.Ftb, durationMs: 800 }]
		)
		expect(frames(tl(), s)).toEqual([{ type: 'FTB', active: true, durationMs: 800 }, { type: 'GO_LIVE' }])
		// Removing the on-air object does not cut the stream.
		expect(frames(s, tl())).toEqual([{ type: 'FTB', active: false }])
	})

	test('commands carry the originating timeline object id', () => {
		const s = tl(['ol_pgm', 'cam1', { type: TimelineContentTypeOpenLive.Program, input: 'video_in_1' }])
		expect(diffStates(undefined, convertTimelineStateToDeviceState(s, mappings))[0].timelineObjId).toBe('cam1')
	})
})
