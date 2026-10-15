import { createPoolAdjustCommand } from './poolAdjust.js';

export const spendCommand = createPoolAdjustCommand({
	name: 'spend',
	description: 'Spend a point of a temporary pool - Blood, Willpower, and the like',
	descriptionPtBr: 'Gasta um ponto de uma reserva temporária - Sangue, Força de Vontade, e afins',
	sign: -1,
	defaultReason: 'Spent in play',
});
