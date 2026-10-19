import {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	MessageFlags,
	type ChatInputCommandInteraction,
	type ButtonInteraction,
	type ModalSubmitInteraction,
	type User,
} from 'discord.js';
import type { CommandContext } from './registry.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolvePublicLocale, type Locale } from '../i18n/index.js';
import { activeCharacterFor, type ActiveCharacter } from '../challenges/activeCharacter.js';
import { loadGuildSettings } from './settings.js';
import { createChallenge, loadChallenge, saveChallenge, settleChallenge, recordCost, type ChallengeRow, type ChallengeKind } from '../challenges/store.js';
import {
	submitClaim,
	validateClaim,
	throwGestures,
	validateGesture,
	callNegativeTrait,
	bidNegativeTraitResponse,
	validateOverbid,
	submitOverbid,
	validateRetest,
	spendRetestSource,
	validateBlock,
	spendBlocker,
	recordBlockedRetest,
	latestThrow,
	otherSide,
	settle,
	settleRelent,
	type Terms,
	type Claim,
	type Gesture,
	type Side,
	type Category,
	type ChallengeState,
} from '../challenges/engine.js';
import { applyCosts, type CostTarget, type TraitLocation } from '../challenges/costs.js';
import type { Connection } from '../be/temporaryState.js';

const TERMS_MODAL_ID = 'challenge:terms';
const CLAIM_MODAL_PREFIX = 'challenge:claim:';
const NEGATIVE_TRAIT_CALL_ID = 'challenge:negativeTrait:call';
const NEGATIVE_TRAIT_MODAL_ID = 'challenge:negativeTrait:modal';
const NEGATIVE_TRAIT_YES_ID = 'challenge:negativeTrait:yes';
const NEGATIVE_TRAIT_NO_ID = 'challenge:negativeTrait:no';
const NEGATIVE_TRAIT_BID_ID = 'challenge:negativeTrait:bid';
const NEGATIVE_TRAIT_RELENT_ID = 'challenge:negativeTrait:relent';
const EXTRA_TRAIT_MODAL_ID = 'challenge:negativeTrait:extraTraitModal';
const LOSER_ACCEPT_ID = 'challenge:loser:accept';
const LOSER_OVERBID_ID = 'challenge:loser:overbid';
const LOSER_RETEST_ID = 'challenge:loser:retest';
const OVERBID_MODAL_ID = 'challenge:overbid:modal';
const RETEST_MODAL_ID = 'challenge:retest:modal';
const BLOCK_ID = 'challenge:retest:block';
const ALLOW_ID = 'challenge:retest:allow';
const BLOCK_MODAL_ID = 'challenge:retest:blockModal';
const GESTURES: Gesture[] = ['rock', 'paper', 'scissors', 'bomb'];
const GESTURE_LABEL_KEY: Record<Gesture, string> = {
	rock: 'challenge.gestureRock',
	paper: 'challenge.gesturePaper',
	scissors: 'challenge.gestureScissors',
	bomb: 'challenge.gestureBomb',
};
const CATEGORY_LABEL_KEY: Record<Category, string> = {
	physical: 'challenge.categoryPhysical',
	social: 'challenge.categorySocial',
	mental: 'challenge.categoryMental',
};

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
}

async function loadConnection(context: CommandContext, guildId: string): Promise<ConnectionRow | null> {
	const { rows } = await context.pool.query<ConnectionRow>(
		'SELECT be_connection_id, secret_enc, rest_root, game_slug FROM connections WHERE guild_id = $1',
		[guildId]
	);
	return rows[0] ?? null;
}

function parseCommaList(raw: string): string[] {
	return raw
		.split(',')
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function sideFor(challenge: ChallengeRow, discordUserId: string): Side | null {
	if (challenge.challengerDiscordId === discordUserId) {
		return 'challenger';
	}
	if (challenge.defenderDiscordId === discordUserId) {
		return 'defender';
	}
	return null;
}

function termsModal(locale: Locale): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(TERMS_MODAL_ID)
		.setTitle(t(locale, 'challenge.termsModalTitle'))
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('appropriate_traits').setLabel(t(locale, 'challenge.fieldAppropriateTraits')).setStyle(TextInputStyle.Short).setRequired(true)
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('your_sources').setLabel(t(locale, 'challenge.fieldYourSources')).setStyle(TextInputStyle.Short).setRequired(false)
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('your_blockers').setLabel(t(locale, 'challenge.fieldYourBlockers')).setStyle(TextInputStyle.Short).setRequired(false)
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('their_sources').setLabel(t(locale, 'challenge.fieldTheirSources')).setStyle(TextInputStyle.Short).setRequired(false)
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('their_blockers').setLabel(t(locale, 'challenge.fieldTheirBlockers')).setStyle(TextInputStyle.Short).setRequired(false)
			)
		);
}

function claimModal(locale: Locale): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(`${CLAIM_MODAL_PREFIX}submit`)
		.setTitle(t(locale, 'challenge.claimModalTitle'))
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('trait_count').setLabel(t(locale, 'challenge.fieldTraitCount')).setStyle(TextInputStyle.Short).setRequired(true)
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('has_bomb').setLabel(t(locale, 'challenge.fieldHasBomb')).setStyle(TextInputStyle.Short).setRequired(false)
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('retest_source').setLabel(t(locale, 'challenge.fieldRetestSource')).setStyle(TextInputStyle.Short).setRequired(false)
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('bid_trait').setLabel(t(locale, 'challenge.fieldBidTrait')).setStyle(TextInputStyle.Short).setRequired(true)
			)
		);
}

function actionRow(locale: Locale): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId('challenge:relent').setLabel(t(locale, 'challenge.relentButton')).setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId('challenge:dispute').setLabel(t(locale, 'challenge.disputeButton')).setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('challenge:claim').setLabel(t(locale, 'challenge.claimButton')).setStyle(ButtonStyle.Primary)
	);
}

function throwRow(locale: Locale, offerBomb: boolean): ActionRowBuilder<ButtonBuilder> {
	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId('challenge:throw:rock').setLabel(t(locale, GESTURE_LABEL_KEY.rock)).setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('challenge:throw:paper').setLabel(t(locale, GESTURE_LABEL_KEY.paper)).setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('challenge:throw:scissors').setLabel(t(locale, GESTURE_LABEL_KEY.scissors)).setStyle(ButtonStyle.Secondary)
	);
	if (offerBomb) {
		row.addComponents(new ButtonBuilder().setCustomId('challenge:throw:bomb').setLabel(t(locale, GESTURE_LABEL_KEY.bomb)).setStyle(ButtonStyle.Danger));
	}
	return row;
}

function negativeTraitRow(locale: Locale): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(NEGATIVE_TRAIT_CALL_ID).setLabel(t(locale, 'challenge.negativeTraitButton')).setStyle(ButtonStyle.Secondary)
	);
}

function negativeTraitModal(locale: Locale): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(NEGATIVE_TRAIT_MODAL_ID)
		.setTitle(t(locale, 'challenge.negativeTraitModalTitle'))
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('negative_trait_name').setLabel(t(locale, 'challenge.fieldNegativeTraitName')).setStyle(TextInputStyle.Short).setRequired(true)
			)
		);
}

function negativeTraitAnswerRow(locale: Locale): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(NEGATIVE_TRAIT_YES_ID).setLabel(t(locale, 'challenge.negativeTraitYesButton')).setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId(NEGATIVE_TRAIT_NO_ID).setLabel(t(locale, 'challenge.negativeTraitNoButton')).setStyle(ButtonStyle.Secondary)
	);
}

function negativeTraitChoiceRow(locale: Locale): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(NEGATIVE_TRAIT_BID_ID).setLabel(t(locale, 'challenge.bidExtraTraitButton')).setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId(NEGATIVE_TRAIT_RELENT_ID).setLabel(t(locale, 'challenge.relentButton')).setStyle(ButtonStyle.Danger)
	);
}

function extraTraitModal(locale: Locale): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(EXTRA_TRAIT_MODAL_ID)
		.setTitle(t(locale, 'challenge.extraTraitModalTitle'))
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('extra_trait_name').setLabel(t(locale, 'challenge.fieldExtraTraitName')).setStyle(TextInputStyle.Short).setRequired(true)
			)
		);
}

function loserChoiceRow(locale: Locale, offerRetest: boolean): ActionRowBuilder<ButtonBuilder> {
	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(LOSER_ACCEPT_ID).setLabel(t(locale, 'challenge.acceptLossButton')).setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(LOSER_OVERBID_ID).setLabel(t(locale, 'challenge.overbidButton')).setStyle(ButtonStyle.Primary)
	);
	if (offerRetest) {
		row.addComponents(new ButtonBuilder().setCustomId(LOSER_RETEST_ID).setLabel(t(locale, 'challenge.retestButton')).setStyle(ButtonStyle.Secondary));
	}
	return row;
}

function overbidModal(locale: Locale): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(OVERBID_MODAL_ID)
		.setTitle(t(locale, 'challenge.overbidModalTitle'))
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('overbid_count').setLabel(t(locale, 'challenge.fieldOverbidCount')).setStyle(TextInputStyle.Short).setRequired(true)
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('overbid_trait').setLabel(t(locale, 'challenge.fieldOverbidTrait')).setStyle(TextInputStyle.Short).setRequired(true)
			)
		);
}

function retestModal(locale: Locale): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(RETEST_MODAL_ID)
		.setTitle(t(locale, 'challenge.retestModalTitle'))
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('retest_source_name').setLabel(t(locale, 'challenge.fieldRetestSourceName')).setStyle(TextInputStyle.Short).setRequired(true)
			)
		);
}

function blockChoiceRow(locale: Locale): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(BLOCK_ID).setLabel(t(locale, 'challenge.blockButton')).setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId(ALLOW_ID).setLabel(t(locale, 'challenge.allowButton')).setStyle(ButtonStyle.Secondary)
	);
}

function blockModal(locale: Locale): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(BLOCK_MODAL_ID)
		.setTitle(t(locale, 'challenge.blockModalTitle'))
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('block_source_name').setLabel(t(locale, 'challenge.fieldBlockSourceName')).setStyle(TextInputStyle.Short).setRequired(true)
			)
		);
}

function retestAvailable(state: ChallengeState, side: Side): boolean {
	const declared = side === 'challenger' ? state.terms.challengerSources : state.terms.defenderSources;
	return declared.some((source) => !state[side].usedSources.includes(source));
}

function characterOf(
	side: Side,
	challenger: ActiveCharacter,
	defender: ActiveCharacter | null,
	challengerDiscordId: string,
	defenderDiscordId: string
): { characterId: number; discordUserId: string } | null {
	if (side === 'challenger') {
		return { characterId: challenger.id, discordUserId: challengerDiscordId };
	}
	return defender ? { characterId: defender.id, discordUserId: defenderDiscordId } : null;
}

export interface ChallengeFlowOptions {
	opponentUser: User;
	category: Category;
	conditions: string;
	kind: ChallengeKind;
	/** False for a Narrator claiming a difficulty count in `/static` - no BE character is looked up or resolved for the defender side, and no BE cost is ever charged to it. */
	requireDefenderCharacter: boolean;
}

export const challengeCommand = {
	data: new SlashCommandBuilder()
		.setName('challenge')
		.setDescription("Starts a claims-based challenge against another player's character")
		.setDescriptionLocalizations({ 'pt-BR': 'Inicia um desafio por reivindicações contra o personagem de outro jogador' })
		.addUserOption((option) =>
			option
				.setName('opponent')
				.setDescription("The Discord account whose active character you're challenging")
				.setDescriptionLocalizations({ 'pt-BR': 'A conta do Discord cujo personagem ativo você está desafiando' })
				.setRequired(true)
		)
		.addStringOption((option) =>
			option
				.setName('category')
				.setDescription('Physical, Social or Mental')
				.setDescriptionLocalizations({ 'pt-BR': 'Físico, Social ou Mental' })
				.setRequired(true)
				.addChoices(
					{ name: 'Physical', value: 'physical', name_localizations: { 'pt-BR': 'Físico' } },
					{ name: 'Social', value: 'social', name_localizations: { 'pt-BR': 'Social' } },
					{ name: 'Mental', value: 'mental', name_localizations: { 'pt-BR': 'Mental' } }
				)
		)
		.addStringOption((option) =>
			option
				.setName('conditions')
				.setDescription('What is physically happening - "I swing my sword at you"')
				.setDescriptionLocalizations({ 'pt-BR': 'O que está acontecendo - "Eu te ataco com minha espada"' })
				.setRequired(true)
		) as SlashCommandBuilder,

	async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
		await runChallengeFlow(interaction, context, {
			opponentUser: interaction.options.getUser('opponent', true),
			category: interaction.options.getString('category', true) as Category,
			conditions: interaction.options.getString('conditions', true),
			kind: 'contested',
			requireDefenderCharacter: true,
		});
	},
};

export async function runChallengeFlow(interaction: ChatInputCommandInteraction, context: CommandContext, options: ChallengeFlowOptions): Promise<void> {
	const { opponentUser, category, conditions, kind, requireDefenderCharacter } = options;
	const locale: Locale = interaction.locale === 'pt-BR' ? 'pt-BR' : 'en-US';
	if (!interaction.inGuild() || !interaction.guildId) {
		return;
	}
	const guildId = interaction.guildId;

	if (opponentUser.id === interaction.user.id) {
		await interaction.reply({ content: t(locale, 'challenge.cannotBeYourself'), flags: MessageFlags.Ephemeral });
		return;
	}

	const connection = await loadConnection(context, guildId);
	if (!connection) {
		await interaction.reply({ content: t(locale, 'disconnect.notConnected'), flags: MessageFlags.Ephemeral });
		return;
	}
	const secret = decrypt(connection.secret_enc, context.config.secretKey);
	const beConnection: Connection = { be_connection_id: connection.be_connection_id, rest_root: connection.rest_root, game_slug: connection.game_slug };

	const challengerActive = await activeCharacterFor(context.pool, beConnection, secret, guildId, interaction.user.id);
	if (!challengerActive) {
		await interaction.reply({ content: t(locale, 'challenge.noActiveCharacter'), flags: MessageFlags.Ephemeral });
		return;
	}

	let defenderActive: ActiveCharacter | null = null;
	if (requireDefenderCharacter) {
		defenderActive = await activeCharacterFor(context.pool, beConnection, secret, guildId, opponentUser.id);
		if (!defenderActive) {
			await interaction.reply({ content: t(locale, 'challenge.opponentNoActiveCharacter', { username: opponentUser.username }), flags: MessageFlags.Ephemeral });
			return;
		}
	}
	const defenderName = defenderActive ? defenderActive.name : opponentUser.username;

	await interaction.showModal(termsModal(locale));
		let submitted: ModalSubmitInteraction;
		try {
			submitted = await interaction.awaitModalSubmit({
				filter: (i) => i.customId === TERMS_MODAL_ID && i.user.id === interaction.user.id,
				time: 5 * 60 * 1000,
			});
		} catch {
			return;
		}

		const terms: Terms = {
			category,
			conditions,
			appropriateTraits: submitted.fields.getTextInputValue('appropriate_traits'),
			challengerSources: parseCommaList(submitted.fields.getTextInputValue('your_sources')),
			defenderSources: parseCommaList(submitted.fields.getTextInputValue('their_sources')),
			challengerBlockers: parseCommaList(submitted.fields.getTextInputValue('your_blockers')),
			defenderBlockers: parseCommaList(submitted.fields.getTextInputValue('their_blockers')),
		};

		const settings = await loadGuildSettings(context, guildId);
		const expiresAt = new Date(Date.now() + settings.challenge_timeout_minutes * 60 * 1000);

		const challenge = await createChallenge(context.pool, {
			guildId,
			channelId: interaction.channelId,
			kind,
			challengerDiscordId: interaction.user.id,
			defenderDiscordId: opponentUser.id,
			category,
			conditions,
			terms,
			expiresAt,
		});

		await submitted.reply({
			content: t(locale, 'challenge.posted', {
				challenger: challengerActive.name,
				defender: defenderName,
				category: t(locale, CATEGORY_LABEL_KEY[category]),
				conditions,
				traits: terms.appropriateTraits,
			}),
			components: [actionRow(locale)],
		});
		const message = await submitted.fetchReply();

		const collector = message.createMessageComponentCollector({
			filter: (i) => i.user.id === interaction.user.id || i.user.id === opponentUser.id,
			time: settings.challenge_timeout_minutes * 60 * 1000,
		});

		const traitLocations: TraitLocation[] = [];
		const abilityLocations: TraitLocation[] = [];
		for (const source of [...terms.challengerSources, ...terms.defenderSources]) {
			abilityLocations.push({ trait: source, blockSlug: '' });
		}

		async function settleAndReport(state: ChallengeState, outcome: ReturnType<typeof settle>): Promise<void> {
			const target: CostTarget = {
				challenger: characterOf('challenger', challengerActive!, defenderActive, interaction.user.id, opponentUser.id),
				defender: characterOf('defender', challengerActive!, defenderActive, interaction.user.id, opponentUser.id),
				reason: `Lost a ${category} challenge against ${outcome.loser === 'defender' ? challengerActive!.name : defenderName}`,
				traitLocations,
				abilityLocations,
			};
			const applied = await applyCosts(beConnection, secret, outcome, target);
			for (const cost of applied) {
				const payload = { ...cost.payload, side: cost.side, ...(cost.noCharacter ? { noCharacter: true } : {}) };
				await recordCost(context.pool, challenge.id, cost.kind, payload, null);
			}
			await settleChallenge(context.pool, challenge.id, { ...state, outcome });

			const resultText =
				outcome.loser === 'both'
					? t(locale, 'challenge.resultDraw')
					: t(locale, 'challenge.resultWin', {
							winnerName: outcome.loser === 'defender' ? challengerActive!.name : defenderName,
							loserName: outcome.loser === 'defender' ? defenderName : challengerActive!.name,
							category: t(locale, CATEGORY_LABEL_KEY[category]),
						});
			const lostTraits = outcome.lostTraits.join(', ') || '—';
			await message
				.edit({
					content: `${t(locale, 'challenge.posted', { challenger: challengerActive!.name, defender: defenderName, category: t(locale, CATEGORY_LABEL_KEY[category]), conditions, traits: terms.appropriateTraits })}\n\n${resultText}\n${t(locale, 'challenge.costsApplied', { loserName: outcome.loser === 'both' ? `${challengerActive!.name} / ${defenderName}` : outcome.loser === 'defender' ? defenderName : challengerActive!.name, traits: lostTraits })}`,
					components: [],
				})
				.catch(() => undefined);
			collector.stop();
		}

		async function presentLoserChoice(state: ChallengeState, loserSide: Side): Promise<void> {
			if (!message.channel.isSendable()) {
				return;
			}
			const loserDiscordId = loserSide === 'challenger' ? interaction.user.id : opponentUser.id;
			const loserName = loserSide === 'challenger' ? challengerActive!.name : defenderName;
			const promptText = t(locale, 'challenge.loserChoicePrompt', { loser: loserName });
			const prompt = await message.channel.send({ content: promptText, components: [loserChoiceRow(locale, retestAvailable(state, loserSide))] });

			let choice: ButtonInteraction;
			try {
				choice = await prompt.awaitMessageComponent({
					componentType: ComponentType.Button,
					filter: (i) => i.user.id === loserDiscordId,
					time: settings.challenge_timeout_minutes * 60 * 1000,
				});
			} catch {
				await prompt.edit({ content: `${promptText}\n\n${t(locale, 'challenge.negativeTraitTimedOut')}`, components: [] }).catch(() => undefined);
				return;
			}

			if (choice.customId === LOSER_ACCEPT_ID) {
				await choice.deferUpdate();
				await prompt.edit({ components: [] }).catch(() => undefined);
				await settleAndReport(state, settle(state));
				return;
			}

			if (choice.customId === LOSER_RETEST_ID) {
				await choice.showModal(retestModal(locale));
				let retestSubmission: ModalSubmitInteraction;
				try {
					retestSubmission = await choice.awaitModalSubmit({
						filter: (i) => i.customId === RETEST_MODAL_ID && i.user.id === loserDiscordId,
						time: 5 * 60 * 1000,
					});
				} catch {
					return;
				}
				const source = retestSubmission.fields.getTextInputValue('retest_source_name').trim();
				const retestCheck = validateRetest(state, loserSide, source);
				if (!retestCheck.ok) {
					await retestSubmission.reply({ content: t(locale, 'challenge.retestSourceInvalid'), flags: MessageFlags.Ephemeral });
					return;
				}
				const afterSpend = spendRetestSource(state, loserSide, source);
				await saveChallenge(context.pool, challenge.id, afterSpend, 'retest');
				await retestSubmission.reply({ content: t(locale, 'challenge.claimRecorded'), flags: MessageFlags.Ephemeral });

				const blockingSide = otherSide(loserSide);
				const blockingDiscordId = blockingSide === 'challenger' ? interaction.user.id : opponentUser.id;
				const blockingName = blockingSide === 'challenger' ? challengerActive!.name : defenderName;
				await prompt
					.edit({ content: `${promptText}\n\n${t(locale, 'challenge.retestAccepted', { blocker: blockingName })}`, components: [blockChoiceRow(locale)] })
					.catch(() => undefined);

				let blockChoice: ButtonInteraction;
				try {
					blockChoice = await prompt.awaitMessageComponent({
						componentType: ComponentType.Button,
						filter: (i) => i.user.id === blockingDiscordId,
						time: settings.challenge_timeout_minutes * 60 * 1000,
					});
				} catch {
					await prompt.edit({ components: [] }).catch(() => undefined);
					return;
				}

				if (blockChoice.customId === ALLOW_ID) {
					await blockChoice.deferUpdate();
					await prompt
						.edit({ content: `${promptText}\n\n${t(locale, 'challenge.retestAllowed', { blocker: blockingName })}`, components: [] })
						.catch(() => undefined);
					const latestForRetest = await loadChallenge(context.pool, challenge.id);
					if (!latestForRetest) {
						return;
					}
					const cleared = latestForRetest.state;
					cleared.challenger.gesture = null;
					cleared.defender.gesture = null;
					await saveChallenge(context.pool, challenge.id, cleared, 'retest');
					await message.edit({ components: [throwRow(locale, true)] }).catch(() => undefined);
					return;
				}

				await blockChoice.showModal(blockModal(locale));
				let blockSubmission: ModalSubmitInteraction;
				try {
					blockSubmission = await blockChoice.awaitModalSubmit({
						filter: (i) => i.customId === BLOCK_MODAL_ID && i.user.id === blockingDiscordId,
						time: 5 * 60 * 1000,
					});
				} catch {
					return;
				}
				const blocker = blockSubmission.fields.getTextInputValue('block_source_name').trim();
				const latestForBlock = await loadChallenge(context.pool, challenge.id);
				if (!latestForBlock) {
					return;
				}
				const blockCheck = validateBlock(latestForBlock.state, blockingSide, blocker);
				if (!blockCheck.ok) {
					await blockSubmission.reply({ content: t(locale, 'challenge.blockSourceInvalid'), flags: MessageFlags.Ephemeral });
					return;
				}
				const afterBlockSpend = spendBlocker(latestForBlock.state, blockingSide, blocker);
				const blocked = recordBlockedRetest(afterBlockSpend, loserSide);
				await blockSubmission.reply({ content: t(locale, 'challenge.claimRecorded'), flags: MessageFlags.Ephemeral });
				await prompt
					.edit({ content: `${promptText}\n\n${t(locale, 'challenge.retestBlocked', { blocker: blockingName, source: blocker })}`, components: [] })
					.catch(() => undefined);
				await settleAndReport(blocked, settle(blocked));
				return;
			}

			await choice.showModal(overbidModal(locale));
			let overbidSubmission: ModalSubmitInteraction;
			try {
				overbidSubmission = await choice.awaitModalSubmit({
					filter: (i) => i.customId === OVERBID_MODAL_ID && i.user.id === loserDiscordId,
					time: 5 * 60 * 1000,
				});
			} catch {
				return;
			}

			const overbidCount = Number(overbidSubmission.fields.getTextInputValue('overbid_count'));
			const overbidTrait = overbidSubmission.fields.getTextInputValue('overbid_trait').trim();
			const overbidCheck = validateOverbid(state, Number.isFinite(overbidCount) ? overbidCount : 0);
			if (!overbidCheck.ok) {
				await overbidSubmission.reply({ content: t(locale, 'challenge.overbidTooLow'), flags: MessageFlags.Ephemeral });
				return;
			}
			traitLocations.push({ trait: overbidTrait, blockSlug: '' });

			const withOverbid = submitOverbid(state, loserSide, overbidTrait);
			withOverbid.challenger.gesture = null;
			withOverbid.defender.gesture = null;
			await saveChallenge(context.pool, challenge.id, withOverbid, 'overbid');
			await overbidSubmission.reply({ content: t(locale, 'challenge.overbidAccepted'), flags: MessageFlags.Ephemeral });
			await prompt.edit({ content: `${promptText}\n\n${t(locale, 'challenge.overbidThrown')}`, components: [] }).catch(() => undefined);
			await message.edit({ components: [throwRow(locale, true)] }).catch(() => undefined);
		}

		async function handleThrow(buttonInteraction: ButtonInteraction, gesture: Gesture): Promise<void> {
			const current = await loadChallenge(context.pool, challenge.id);
			if (!current) {
				return;
			}
			const side = sideFor(current, buttonInteraction.user.id);
			if (!side) {
				await buttonInteraction.reply({ content: t(locale, 'challenge.notYourChallenge'), flags: MessageFlags.Ephemeral });
				return;
			}
			const gestureCheck = validateGesture(current.state, side, gesture);
			if (!gestureCheck.ok) {
				await buttonInteraction.reply({ content: t(locale, 'challenge.notYourChallenge'), flags: MessageFlags.Ephemeral });
				return;
			}
			if (current.state[side].gesture !== null) {
				await buttonInteraction.reply({ content: t(locale, 'challenge.alreadyThrown'), flags: MessageFlags.Ephemeral });
				return;
			}

			const isOverbidRound = current.status === 'overbid';
			let next = current.state;
			next[side] = { ...next[side], gesture };
			const otherGesture = next[otherSide(side)].gesture;
			await buttonInteraction.reply({ content: t(locale, 'challenge.gestureRecorded'), flags: MessageFlags.Ephemeral });

			if (otherGesture === null) {
				await saveChallenge(context.pool, challenge.id, next, isOverbidRound ? 'overbid' : 'throwing');
				return;
			}

			const challengerGesture = side === 'challenger' ? gesture : (otherGesture as Gesture);
			const defenderGesture = side === 'defender' ? gesture : (otherGesture as Gesture);
			const thrown = throwGestures(next, challengerGesture, defenderGesture, isOverbidRound ? 'overbid' : 'initial');
			const last = latestThrow(thrown)!;
			if (last.winner === 'draw') {
				await settleAndReport(thrown, settle(thrown));
				return;
			}
			await saveChallenge(context.pool, challenge.id, thrown, 'resolved');
			await presentLoserChoice(thrown, otherSide(last.winner));
		}

		async function handleClaim(buttonInteraction: ButtonInteraction): Promise<void> {
			const current = await loadChallenge(context.pool, challenge.id);
			if (!current) {
				return;
			}
			const side = sideFor(current, buttonInteraction.user.id);
			if (!side) {
				await buttonInteraction.reply({ content: t(locale, 'challenge.notYourChallenge'), flags: MessageFlags.Ephemeral });
				return;
			}
			if (current.state[side].claim !== null) {
				await buttonInteraction.reply({ content: t(locale, 'challenge.alreadyClaimed'), flags: MessageFlags.Ephemeral });
				return;
			}

			await buttonInteraction.showModal(claimModal(locale));
			let claimSubmission: ModalSubmitInteraction;
			try {
				claimSubmission = await buttonInteraction.awaitModalSubmit({
					filter: (i) => i.customId === `${CLAIM_MODAL_PREFIX}submit` && i.user.id === buttonInteraction.user.id,
					time: 5 * 60 * 1000,
				});
			} catch {
				return;
			}

			const traitCount = Number(claimSubmission.fields.getTextInputValue('trait_count'));
			const claim: Claim = {
				traitCount: Number.isFinite(traitCount) ? traitCount : 0,
				hasBomb: /^(y|yes|s|sim)$/i.test(claimSubmission.fields.getTextInputValue('has_bomb').trim()),
				retestSource: claimSubmission.fields.getTextInputValue('retest_source').trim() || null,
				bidTrait: claimSubmission.fields.getTextInputValue('bid_trait').trim(),
			};
			traitLocations.push({ trait: claim.bidTrait, blockSlug: '' });

			if (settings.trait_cap !== null) {
				const capCheck = validateClaim(claim, settings.trait_cap);
				if (!capCheck.ok) {
					await claimSubmission.reply({ content: t(locale, 'challenge.claimOverCap', { cap: settings.trait_cap }), flags: MessageFlags.Ephemeral });
					return;
				}
			}

			const next = submitClaim(current.state, side, claim);
			const otherClaim = next[side === 'challenger' ? 'defender' : 'challenger'].claim;
			await saveChallenge(context.pool, challenge.id, next, otherClaim === null ? 'claiming' : 'throwing');

			await claimSubmission.reply({ content: t(locale, 'challenge.claimRecorded'), flags: MessageFlags.Ephemeral });

			if (otherClaim !== null) {
				await message.edit({ components: [negativeTraitRow(locale), throwRow(locale, true)] }).catch(() => undefined);
			}
		}

		async function handleNegativeTraitCall(buttonInteraction: ButtonInteraction): Promise<void> {
			const current = await loadChallenge(context.pool, challenge.id);
			if (!current) {
				return;
			}
			const side = sideFor(current, buttonInteraction.user.id);
			if (side !== 'challenger') {
				await buttonInteraction.reply({ content: t(locale, 'challenge.notYourChallenge'), flags: MessageFlags.Ephemeral });
				return;
			}
			if (current.state.negativeTrait !== null) {
				await buttonInteraction.reply({ content: t(locale, 'challenge.negativeTraitAlreadyCalled'), flags: MessageFlags.Ephemeral });
				return;
			}

			await buttonInteraction.showModal(negativeTraitModal(locale));
			let modalSubmission: ModalSubmitInteraction;
			try {
				modalSubmission = await buttonInteraction.awaitModalSubmit({
					filter: (i) => i.customId === NEGATIVE_TRAIT_MODAL_ID && i.user.id === buttonInteraction.user.id,
					time: 5 * 60 * 1000,
				});
			} catch {
				return;
			}
			const trait = modalSubmission.fields.getTextInputValue('negative_trait_name').trim();
			await modalSubmission.reply({ content: t(locale, 'challenge.negativeTraitWaiting'), flags: MessageFlags.Ephemeral });

			if (!message.channel.isSendable()) {
				return;
			}
			const promptText = t(locale, 'challenge.negativeTraitPrompt', { challenger: challengerActive!.name, defender: defenderName, trait });
			const prompt = await message.channel.send({ content: promptText, components: [negativeTraitAnswerRow(locale)] });

			let answer: ButtonInteraction;
			try {
				answer = await prompt.awaitMessageComponent({
					componentType: ComponentType.Button,
					filter: (i) => i.user.id === opponentUser.id,
					time: settings.challenge_timeout_minutes * 60 * 1000,
				});
			} catch {
				await prompt.edit({ content: `${promptText}\n\n${t(locale, 'challenge.negativeTraitTimedOut')}`, components: [] }).catch(() => undefined);
				return;
			}

			const beforeAnswer = await loadChallenge(context.pool, challenge.id);
			if (!beforeAnswer) {
				return;
			}

			if (answer.customId === NEGATIVE_TRAIT_NO_ID) {
				const next = callNegativeTrait(beforeAnswer.state, trait, false);
				await saveChallenge(context.pool, challenge.id, next, 'throwing');
				await answer.update({
					content: `${promptText}\n\n${t(locale, 'challenge.negativeTraitDenied', { defender: defenderName, trait, challenger: challengerActive!.name })}`,
					components: [],
				});
				await message.edit({ components: [throwRow(locale, true)] }).catch(() => undefined);
				return;
			}

			const withCall = callNegativeTrait(beforeAnswer.state, trait, true);
			await saveChallenge(context.pool, challenge.id, withCall, 'negative_trait');
			await answer.update({
				content: `${promptText}\n\n${t(locale, 'challenge.negativeTraitConfirmed', { defender: defenderName, trait })}`,
				components: [],
			});

			const choiceMessage = await answer.followUp({
				content: t(locale, 'challenge.negativeTraitChoicePrompt'),
				components: [negativeTraitChoiceRow(locale)],
				flags: MessageFlags.Ephemeral,
			});

			let choice: ButtonInteraction;
			try {
				choice = await choiceMessage.awaitMessageComponent({
					componentType: ComponentType.Button,
					filter: (i) => i.user.id === opponentUser.id,
					time: 5 * 60 * 1000,
				});
			} catch {
				return;
			}

			if (choice.customId === NEGATIVE_TRAIT_RELENT_ID) {
				await choice.deferUpdate();
				const latestForRelent = await loadChallenge(context.pool, challenge.id);
				if (!latestForRelent) {
					return;
				}
				await settleAndReport(latestForRelent.state, settleRelent('defender'));
				return;
			}

			await choice.showModal(extraTraitModal(locale));
			let extraSubmission: ModalSubmitInteraction;
			try {
				extraSubmission = await choice.awaitModalSubmit({
					filter: (i) => i.customId === EXTRA_TRAIT_MODAL_ID && i.user.id === opponentUser.id,
					time: 5 * 60 * 1000,
				});
			} catch {
				return;
			}
			const extraTrait = extraSubmission.fields.getTextInputValue('extra_trait_name').trim();
			traitLocations.push({ trait: extraTrait, blockSlug: '' });

			const latestForBid = await loadChallenge(context.pool, challenge.id);
			if (!latestForBid) {
				return;
			}
			const withBid = bidNegativeTraitResponse(latestForBid.state, extraTrait);
			await saveChallenge(context.pool, challenge.id, withBid, 'throwing');
			await extraSubmission.reply({ content: t(locale, 'challenge.claimRecorded'), flags: MessageFlags.Ephemeral });
			await message.edit({ components: [throwRow(locale, true)] }).catch(() => undefined);
		}

		async function handleRelent(buttonInteraction: ButtonInteraction): Promise<void> {
			const current = await loadChallenge(context.pool, challenge.id);
			if (!current) {
				return;
			}
			const side = sideFor(current, buttonInteraction.user.id);
			if (side !== 'defender') {
				await buttonInteraction.reply({ content: t(locale, 'challenge.notYourChallenge'), flags: MessageFlags.Ephemeral });
				return;
			}
			await buttonInteraction.deferUpdate();
			const outcome = settleRelent('defender');
			await settleAndReport(current.state, outcome);
		}

		async function handleDispute(buttonInteraction: ButtonInteraction): Promise<void> {
			const current = await loadChallenge(context.pool, challenge.id);
			if (!current) {
				return;
			}
			const side = sideFor(current, buttonInteraction.user.id);
			if (!side) {
				await buttonInteraction.reply({ content: t(locale, 'challenge.notYourChallenge'), flags: MessageFlags.Ephemeral });
				return;
			}
			await saveChallenge(context.pool, challenge.id, current.state, 'disputed');
			await buttonInteraction.reply({ content: t(locale, 'challenge.disputed') });

			if (settings.staff_channel_id) {
				const publicLocale = resolvePublicLocale(settings.locale, interaction.guild?.preferredLocale ?? null, context.config.defaultLocale);
				const channel = await interaction.guild?.channels.fetch(settings.staff_channel_id).catch(() => null);
				if (channel?.isTextBased()) {
					await channel.send(t(publicLocale, 'challenge.staffDisputePing', { username: buttonInteraction.user.username, channelId: interaction.channelId }));
				}
			}
		}

		const onHandlerError = (error: unknown): void => {
			context.logger.error({ error: error instanceof Error ? error.message : String(error) }, 'challenge button handling failed');
		};

		collector.on('collect', (buttonInteraction: ButtonInteraction) => {
			if (buttonInteraction.customId === 'challenge:relent') {
				handleRelent(buttonInteraction).catch(onHandlerError);
			} else if (buttonInteraction.customId === 'challenge:dispute') {
				handleDispute(buttonInteraction).catch(onHandlerError);
			} else if (buttonInteraction.customId === 'challenge:claim') {
				handleClaim(buttonInteraction).catch(onHandlerError);
			} else if (buttonInteraction.customId === NEGATIVE_TRAIT_CALL_ID) {
				handleNegativeTraitCall(buttonInteraction).catch(onHandlerError);
			} else if (buttonInteraction.customId.startsWith('challenge:throw:')) {
				const gesture = buttonInteraction.customId.slice('challenge:throw:'.length) as Gesture;
				if (GESTURES.includes(gesture)) {
					handleThrow(buttonInteraction, gesture).catch(onHandlerError);
				}
			}
		});
}
