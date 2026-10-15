import { createWoundHealCommand } from './woundHeal.js';

export const woundCommand = createWoundHealCommand({
	name: 'wound',
	description: 'Take damage of one type',
	descriptionPtBr: 'Sofre dano de um tipo',
	kind: 'wound',
});
