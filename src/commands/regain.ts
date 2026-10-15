import { createPoolAdjustCommand } from './poolAdjust.js';

export const regainCommand = createPoolAdjustCommand({
	name: 'regain',
	description: 'Regain a point of a temporary pool - Blood, Willpower, and the like',
	descriptionPtBr: 'Recupera um ponto de uma reserva temporária - Sangue, Força de Vontade, e afins',
	sign: 1,
	defaultReason: 'Regained in play',
});
