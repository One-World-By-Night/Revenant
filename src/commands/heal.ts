import { createWoundHealCommand } from './woundHeal.js';

export const healCommand = createWoundHealCommand({
	name: 'heal',
	description: 'Heal damage of one type',
	descriptionPtBr: 'Cura dano de um tipo',
	kind: 'heal',
});
