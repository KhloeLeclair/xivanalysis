import Module from 'parser/core/Module'

// Blame Meishu. No touchy.
const INTERNAL_EVENT_TYPE = Symbol('aoe')

// Sequential damage events with more than this time diff (in ms) will be considered seperate damage pulses
// Consecutive staus events seem to have a longer sequential gap
// At the moment, 200ms threshold seems to parse it correctly
const DEFAULT_AOE_THRESHOLD = 20
const STATUS_AOE_THRESHOLD = 200

const SUPPORTED_EVENTS = [
	'damage',
	'heal',
	'refreshbuff',
	'applybuff',
]

export default class AoE extends Module {
	static handle = 'aoe'
	static dependencies = [
		'precastStatus',
		'enemies',
	]

	constructor(...args) {
		super(...args)
		// Listen to our own event from normalisation
		this.addHook(INTERNAL_EVENT_TYPE, this._onAoe)
	}

	// Need to normalise so the final events can go out at the right time
	normalise(events) {
		// Track hits by source
		const trackers = {}
		function getTracker(event) {
			if (!event.ability) {
				return {}
			}

			if (!trackers[event.sourceID]) {
				trackers[event.sourceID] = {}
			}

			const source = trackers[event.sourceID]
			const abilityId = event.ability.guid

			return source[abilityId] = source[abilityId] || {
				events: {},
				insertAfter: 0,
				timestamp: null,
			}
		}

		const toAdd = []
		function addEvent(tracker) {
			// Set the timestamp to be the very first of all the events
			for (const eventType in tracker.events) {
				if (tracker.events[eventType].length !== 0) {
					tracker.timestamp = tracker.timestamp || tracker.events[eventType][0].timestamp
					tracker.timestamp = tracker.timestamp < tracker.events[eventType][0].timestamp ? tracker.timestamp : tracker.events[eventType][0].timestamp
				}
			}

			toAdd.push({
				...tracker,
				type: INTERNAL_EVENT_TYPE,
			})
		}

		for (let i = 0; i < events.length; i++) {
			const event = events[i]

			if (!SUPPORTED_EVENTS.includes(event.type)) {
				continue
			}

			const tracker = getTracker(event)

			// Get the timestamp of the last event
			let lastHitTimestamp = null
			if (Object.keys(tracker.events).length) {
				for (const eventType in tracker.events) {
					// compare all event groups for the absolute last hit
					const groupLastHit = tracker.events[eventType][tracker.events[eventType].length - 1]

					if (lastHitTimestamp < groupLastHit.timestamp) {
						lastHitTimestamp = groupLastHit.timestamp
					}
				}
			}

			// It seems to be that status events have a longer application gap
			const AOE_THRESHOLD = event.type === 'refreshbuff' || event.type === 'applybuff' ? STATUS_AOE_THRESHOLD : DEFAULT_AOE_THRESHOLD

			// If the last event was too long ago, generate an event
			if (lastHitTimestamp && event.timestamp - lastHitTimestamp > AOE_THRESHOLD) {
				addEvent(tracker)
				tracker.events = {}
				tracker.timestamp = null
			}

			// If this is the first event of it's type, make a new property for it
			if (!tracker.events[event.type]) {
				tracker.events[event.type] = []
			}

			event.i = i
			tracker.events[event.type].push(event)
			tracker.insertAfter = i
		}

		// Run a cleanup
		for (const sourceId in trackers) {
			for (const abilityId in trackers[sourceId]) {
				const tracker = trackers[sourceId][abilityId]

				let shouldCleanup = false

				for (const eventType in tracker.events) {
					if (tracker.events[eventType].length !== 0) {
						shouldCleanup = true
					}
				}
				if (shouldCleanup) {
					addEvent(tracker)
				}
			}
		}

		// Add all the events we gathered up in, in order
		let offset = 0
		toAdd.sort((a, b) => a.insertAfter - b.insertAfter).forEach(event => {
			events.splice(event.insertAfter + 1 + offset, 0, event)
			offset++
		})

		return events
	}

	_onAoe(event) {
		if (!Object.keys(event.events).length) { return }

		for (const eventType in event.events) {
			// Filter out any damage events that don't pass muster
			let hitsByTarget = event.events[eventType]
			if (eventType === 'damage') {
				hitsByTarget = hitsByTarget.filter(this.isValidHit.bind(this))
			}

			// Transform into a simplified format
			hitsByTarget = hitsByTarget.reduce((carry, event) => {
				const key = `${event.targetID}-${event.targetInstance}`
				if (carry[key]) {
					carry[key].times++
				} else {
					carry[key] = {
						id: event.targetID,
						instance: event.targetInstance,
						times: 1,
					}
				}
				return carry
			}, {})

			this.parser.fabricateEvent({
				type: 'aoe' + eventType,
				ability: event.events[eventType][0].ability,
				hits: Object.values(hitsByTarget),
				sourceID: event.events[eventType][0].sourceID,
			})
		}
	}

	isValidHit(event) {
		// Checking the event's target - if we get a falsey value back, it's an invalid target
		return !!this.enemies.getEntity(event.targetID)
	}
}
