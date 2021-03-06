import math from 'mathjsCustom'
import {matchClosestLower} from 'utilities'

export const TARGET = {
	SUCCESS: 2,
	WARN: 1,
	FAIL: undefined,
}

export default class Rule {
	name = ''
	description = null
	requirements = []
	target = 95

	get tier() {
		return matchClosestLower(
			{[this.target]: TARGET.SUCCESS},
			this.percent
		)
	}

	get percent() {
		// WoWA has a bunch of different modes for this stuff, I'm just going to use mean for now. Because I'm mean. Hue.
		// TODO: different requirement modes
		const percents = this.requirements.map(requirement => requirement.percent)
		return percents.length? math.mean(percents) : 0
	}

	constructor(options) {
		Object.keys(options || {}).forEach(key => {
			this[key] = options[key]
		})
	}
}

export class TieredRule extends Rule {
	constructor(options) {
		super({
			tiers: {},
			matcher: matchClosestLower,
			...options,
		})
	}

	get tier() {
		return this.matcher(this.tiers, this.percent)
	}
}
