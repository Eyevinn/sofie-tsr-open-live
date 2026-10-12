import type { DeviceTimelineState, Mapping, Mappings } from 'timeline-state-resolver-types'
import {
	MappingOpenLiveType,
	OpenLiveDeviceType,
	OpenLiveTransition,
	SomeMappingOpenLive,
	TimelineContentOpenLiveAny,
	TimelineContentTypeOpenLive,
} from './types'

/** Inbound command frame, as defined by the Open Live automation contract (minus cmdId). */
export type OpenLiveFrame = { type: string } & Record<string, unknown>

export interface OpenLiveCommandWithContext {
	command: OpenLiveFrame
	context: string
	timelineObjId: string
	queueId?: string
}

interface Tracked {
	/** Timeline object that produced this value ('' when it came from the device) */
	objId: string
}

/**
 * The parts of an Open Live production this device controls.
 * Keys that are absent are "not controlled": the diff leaves them alone.
 */
export interface OpenLiveState {
	program?: Tracked & { input: string; transition?: OpenLiveTransition; afvRampUpMs?: number; afvRampDownMs?: number }
	preview?: Tracked & { input: string }
	dsk: Record<number, Tracked & { visible: boolean }>
	graphics: Record<string, Tracked & { active: boolean }>
	audio: Record<string, Tracked & { volume?: number; muted?: boolean; rampMs?: number }>
	clips: Record<string, Tracked & { active: boolean; clipId?: string; playing: boolean }>
	onAir?: Tracked & { value: boolean }
	ftb?: Tracked & { active: boolean; durationMs?: number }
}

export function emptyState(): OpenLiveState {
	return { dsk: {}, graphics: {}, audio: {}, clips: {} }
}

function isOpenLiveMapping(m: Mapping<unknown>): m is Mapping<SomeMappingOpenLive> {
	return m.device === OpenLiveDeviceType
}

export function convertTimelineStateToDeviceState(
	timelineState: DeviceTimelineState,
	mappings: Mappings
): OpenLiveState {
	const state = emptyState()

	// Keyer-like layers (dsk, graphic, ftb, clip) are "on while an object is active".
	// Seed every mapped one as off so a finished object turns it off.
	for (const mapping of Object.values(mappings)) {
		if (!isOpenLiveMapping(mapping)) continue
		const o = mapping.options
		switch (o.mappingType) {
			case MappingOpenLiveType.Dsk:
				state.dsk[o.layer] = { visible: false, objId: '' }
				break
			case MappingOpenLiveType.Graphic:
				state.graphics[o.overlayId] = { active: false, objId: '' }
				break
			case MappingOpenLiveType.Clip:
				state.clips[o.mixerInput] = { active: false, playing: false, objId: '' }
				break
			case MappingOpenLiveType.Ftb:
				state.ftb = { active: false, objId: '' }
				break
		}
	}

	for (const obj of timelineState.objects) {
		const mapping = mappings[obj.layer] as Mapping<unknown> | undefined
		if (!mapping || !isOpenLiveMapping(mapping)) continue
		const content = obj.content as unknown as TimelineContentOpenLiveAny
		if (content.deviceType !== OpenLiveDeviceType) continue
		const o = mapping.options
		const objId = obj.id

		switch (o.mappingType) {
			case MappingOpenLiveType.Program:
				if (content.type === TimelineContentTypeOpenLive.Program) {
					state.program = {
						objId,
						input: content.input,
						transition: content.transition,
						afvRampUpMs: content.afvRampUpMs,
						afvRampDownMs: content.afvRampDownMs,
					}
				}
				break
			case MappingOpenLiveType.Preview:
				if (content.type === TimelineContentTypeOpenLive.Preview) {
					state.preview = { objId, input: content.input }
				}
				break
			case MappingOpenLiveType.Dsk:
				if (content.type === TimelineContentTypeOpenLive.Dsk) state.dsk[o.layer] = { objId, visible: true }
				break
			case MappingOpenLiveType.Graphic:
				if (content.type === TimelineContentTypeOpenLive.Graphic)
					state.graphics[o.overlayId] = { objId, active: true }
				break
			case MappingOpenLiveType.Audio:
				if (content.type === TimelineContentTypeOpenLive.Audio) {
					state.audio[o.elementId] = { objId, volume: content.volume, muted: content.muted, rampMs: content.rampMs }
				}
				break
			case MappingOpenLiveType.Clip:
				if (content.type === TimelineContentTypeOpenLive.Clip) {
					state.clips[o.mixerInput] = {
						objId,
						active: true,
						clipId: content.clipId,
						playing: content.playing ?? true,
					}
				}
				break
			case MappingOpenLiveType.OnAir:
				if (content.type === TimelineContentTypeOpenLive.OnAir) state.onAir = { objId, value: content.onAir }
				break
			case MappingOpenLiveType.Ftb:
				if (content.type === TimelineContentTypeOpenLive.Ftb)
					state.ftb = { objId, active: true, durationMs: content.durationMs }
				break
		}
	}

	return state
}

function cmd(command: OpenLiveFrame, context: string, timelineObjId: string): OpenLiveCommandWithContext {
	return { command, context, timelineObjId }
}

/**
 * Commands that move Open Live from `oldState` to `newState`.
 * Order matters (program before preview, clip cue before play), so the device
 * runs in sequential execution mode.
 */
export function diffStates(oldState: OpenLiveState | undefined, newState: OpenLiveState): OpenLiveCommandWithContext[] {
	const old = oldState ?? emptyState()
	const out: OpenLiveCommandWithContext[] = []

	// Clips are cued before the cut so a VT is rolling when it hits program.
	for (const [mixerInput, next] of Object.entries(newState.clips)) {
		const prev = old.clips[mixerInput]
		if (next.active) {
			// A new timeline object restarts the clip, but a clip the device reported on
			// (re)connect (objId '') is left running so a reconnect does not re-roll a VT.
			const changedClip =
				!prev?.active || prev.clipId !== next.clipId || (prev.objId !== '' && prev.objId !== next.objId)
			if (changedClip) {
				out.push(
					cmd(
						{ type: 'CLIP_CUE', mixerInput, ...(next.clipId ? { clipId: next.clipId } : {}) },
						`clip ${mixerInput} cued`,
						next.objId
					)
				)
			}
			if (next.playing && (changedClip || !prev?.playing)) {
				out.push(cmd({ type: 'CLIP_PLAY', mixerInput }, `clip ${mixerInput} play`, next.objId))
			} else if (!next.playing && !changedClip && prev?.playing) {
				out.push(cmd({ type: 'CLIP_PAUSE', mixerInput }, `clip ${mixerInput} pause`, next.objId))
			}
		} else if (prev?.active) {
			out.push(cmd({ type: 'CLIP_STOP', mixerInput }, `clip ${mixerInput} ended`, prev.objId))
		}
	}

	if (newState.program && newState.program.input !== old.program?.input) {
		const p = newState.program
		const afv = {
			...(p.afvRampUpMs !== undefined ? { afvRampUpMs: p.afvRampUpMs } : {}),
			...(p.afvRampDownMs !== undefined ? { afvRampDownMs: p.afvRampDownMs } : {}),
		}
		if (p.transition && p.transition.type !== 'cut') {
			out.push(
				cmd(
					{
						type: 'TRANSITION',
						mixerInput: p.input,
						transitionType: p.transition.type,
						...(p.transition.durationMs !== undefined ? { durationMs: p.transition.durationMs } : {}),
						...afv,
					},
					`program → ${p.input} (${p.transition.type})`,
					p.objId
				)
			)
		} else {
			out.push(cmd({ type: 'CUT', mixerInput: p.input, ...afv }, `program → ${p.input}`, p.objId))
		}
	}

	if (newState.preview && newState.preview.input !== old.preview?.input) {
		out.push(
			cmd({ type: 'SET_PVW', mixerInput: newState.preview.input }, `preview → ${newState.preview.input}`, newState.preview.objId)
		)
	}

	for (const [layerKey, next] of Object.entries(newState.dsk)) {
		const layer = Number(layerKey)
		if ((old.dsk[layer]?.visible ?? false) !== next.visible) {
			out.push(cmd({ type: 'DSK_TOGGLE', layer, visible: next.visible }, `dsk ${layer} ${next.visible ? 'on' : 'off'}`, next.objId))
		}
	}

	for (const [overlayId, next] of Object.entries(newState.graphics)) {
		if ((old.graphics[overlayId]?.active ?? false) !== next.active) {
			out.push(
				cmd(
					{ type: next.active ? 'GRAPHIC_ON' : 'GRAPHIC_OFF', overlayId },
					`graphic ${overlayId} ${next.active ? 'on' : 'off'}`,
					next.objId
				)
			)
		}
	}

	for (const [elementId, next] of Object.entries(newState.audio)) {
		const prev = old.audio[elementId]
		if (next.volume !== undefined && next.volume !== prev?.volume) {
			out.push(
				cmd(
					{
						type: 'AUDIO_SET',
						elementId,
						property: 'volume',
						value: next.volume,
						...(next.rampMs !== undefined ? { ramp_ms: next.rampMs } : {}),
					},
					`audio ${elementId} volume ${next.volume}`,
					next.objId
				)
			)
		}
		if (next.muted !== undefined && next.muted !== prev?.muted) {
			out.push(
				cmd({ type: 'AUDIO_SET', elementId, property: 'mute', value: next.muted }, `audio ${elementId} mute ${next.muted}`, next.objId)
			)
		}
	}

	if (newState.ftb && newState.ftb.active !== (old.ftb?.active ?? false)) {
		out.push(
			cmd(
				{
					type: 'FTB',
					active: newState.ftb.active,
					...(newState.ftb.durationMs !== undefined ? { durationMs: newState.ftb.durationMs } : {}),
				},
				`ftb ${newState.ftb.active ? 'on' : 'off'}`,
				newState.ftb.objId
			)
		)
	}

	if (newState.onAir && newState.onAir.value !== old.onAir?.value) {
		out.push(
			cmd({ type: newState.onAir.value ? 'GO_LIVE' : 'CUT_STREAM' }, newState.onAir.value ? 'go live' : 'cut stream', newState.onAir.objId)
		)
	}

	return out
}
