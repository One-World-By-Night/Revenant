import {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	MessageFlags,
	type ChatInputCommandInteraction,
	type ButtonInteraction,
	type ModalSubmitInteraction,
} from 'discord.js';
import type { CommandContext } from './registry.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolvePublicLocale, type Locale } from '../i18n/index.js';
import { activeCharacterFor, type ActiveCharacter } from '../challenges/activeCharacter.js';
import { loadGuildSettings } from './settings.js';
import { createChallenge, loadChallenge, settleChallenge, recordCost, type ChallengeRow } from '../challenges/store.js';
import {
	submitClaim,
	validateClaim,
	throwGestures,
	validateGesture,
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

function characterOf(side: Side, challenger: ActiveCharacter, defender: ActiveCharacter, challengerDiscordId: string, defenderDiscordId: string) {
	return side === 'challenger'
		? { characterId: challenger.id, discordUserId: challengerDiscordId }
		: { characterId: defender.id, discordUserId: defenderDiscordId };
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
		const locale: Locale = interaction.locale === 'pt-BR' ? 'pt-BR' : 'en-US';
		if (!interaction.inGuild() || !interaction.guildId) {
			return;
		}
		const guildId = interaction.guildId;

		const connection = await loadConnection(context, guildId);
		if (!connection) {
			await interaction.reply({ content: t(locale, 'disconnect.notConnected'), flags: MessageFlags.Ephemeral });
			return;
		}
		const secret = decrypt(connection.secret_enc, context.config.secretKey);
		const beConnection: Connection = { be_connection_id: connection.be_connection_id, rest_root: connection.rest_root, game_slug: connection.game_slug };

		const opponentUser = interaction.options.getUser('opponent', true);
		const category = interaction.options.getString('category', true) as Category;
		const conditions = interaction.options.getString('conditions', true);

		const challengerActive = await activeCharacterFor(context.pool, beConnection, secret, guildId, interaction.user.id);
		if (!challengerActive) {
			await interaction.reply({ content: t(locale, 'challenge.noActiveCharacter'), flags: MessageFlags.Ephemeral });
			return;
		}
		const defenderActive = await activeCharacterFor(context.pool, beConnection, secret, guildId, opponentUser.id);
		if (!defenderActive) {
			await interaction.reply({ content: t(locale, 'challenge.opponentNoActiveCharacter', { username: opponentUser.username }), flags: MessageFlags.Ephemeral });
			return;
		}

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
			kind: 'contested',
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
				defender: defenderActive.name,
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
				challenger: characterOf('challenger', challengerActive!, defenderActive!, interaction.user.id, opponentUser.id),
				defender: characterOf('defender', challengerActive!, defenderActive!, interaction.user.id, opponentUser.id),
				reason: `Lost a ${category} challenge against ${outcome.loser === 'defender' ? challengerActive!.name : defenderActive!.name}`,
				traitLocations,
				abilityLocations,
			};
			const applied = await applyCosts(beConnection, secret, outcome, target);
			for (const cost of applied) {
				await recordCost(context.pool, challenge.id, cost.kind, cost.payload, null);
			}
			await settleChallenge(context.pool, challenge.id, state);

			const resultText =
				outcome.loser === 'both'
					? t(locale, 'challenge.resultDraw')
					: t(locale, 'challenge.resultWin', {
							winnerName: outcome.loser === 'defender' ? challengerActive!.name : defenderActive!.name,
							loserName: outcome.loser === 'defender' ? defenderActive!.name : challengerActive!.name,
							category: t(locale, CATEGORY_LABEL_KEY[category]),
						});
			const lostTraits = outcome.lostTraits.join(', ') || '—';
			await message
				.edit({
					content: `${t(locale, 'challenge.posted', { challenger: challengerActive!.name, defender: defenderActive!.name, category: t(locale, CATEGORY_LABEL_KEY[category]), conditions, traits: terms.appropriateTraits })}\n\n${resultText}\n${t(locale, 'challenge.costsApplied', { loserName: outcome.loser === 'both' ? `${challengerActive!.name} / ${defenderActive!.name}` : outcome.loser === 'defender' ? defenderActive!.name : challengerActive!.name, traits: lostTraits })}`,
					components: [],
				})
				.catch(() => undefined);
			collector.stop();
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

			let next = current.state;
			next[side] = { ...next[side], gesture };
			const otherGesture = next[side === 'challenger' ? 'defender' : 'challenger'].gesture;
			await buttonInteraction.reply({ content: t(locale, 'challenge.gestureRecorded'), flags: MessageFlags.Ephemeral });

			if (otherGesture === null) {
				const { saveChallenge } = await import('../challenges/store.js');
				await saveChallenge(context.pool, challenge.id, next, 'throwing');
				return;
			}

			const challengerGesture = side === 'challenger' ? gesture : (otherGesture as Gesture);
			const defenderGesture = side === 'defender' ? gesture : (otherGesture as Gesture);
			next = throwGestures(next, challengerGesture, defenderGesture);
			const outcome = settle(next);
			await settleAndReport(next, outcome);
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
			const { saveChallenge } = await import('../challenges/store.js');
			await saveChallenge(context.pool, challenge.id, next, otherClaim === null ? 'claiming' : 'throwing');

			await claimSubmission.reply({ content: t(locale, 'challenge.claimRecorded'), flags: MessageFlags.Ephemeral });

			if (otherClaim !== null) {
				await message.edit({ components: [throwRow(locale, true)] }).catch(() => undefined);
			}
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
			const { saveChallenge } = await import('../challenges/store.js');
			await saveChallenge(context.pool, challenge.id, current.state, 'disputed');
			await buttonInteraction.reply({ content: t(locale, 'challenge.disputed') });

			if (settings.staff_channel_id) {
				const publicLocale = resolvePublicLocale(settings.locale, interaction.guild?.preferredLocale ?? null, context.config.defaultLocale);
				const channel = await interaction.guild?.channels.fetch(settings.staff_channel_id).catch(() => null);
				if (channel?.isTextBased()) {
					await channel.send(t(publicLocale, 'challenge.staffDisputePing', { username: buttonInteraction.user.username, channelId: interaction.channelId }));
				}
			}
			collector.stop();
		}

		collector.on('collect', (buttonInteraction: ButtonInteraction) => {
			if (buttonInteraction.customId === 'challenge:relent') {
				void handleRelent(buttonInteraction);
			} else if (buttonInteraction.customId === 'challenge:dispute') {
				void handleDispute(buttonInteraction);
			} else if (buttonInteraction.customId === 'challenge:claim') {
				void handleClaim(buttonInteraction);
			} else if (buttonInteraction.customId.startsWith('challenge:throw:')) {
				const gesture = buttonInteraction.customId.slice('challenge:throw:'.length) as Gesture;
				if (GESTURES.includes(gesture)) {
					void handleThrow(buttonInteraction, gesture);
				}
			}
		});
	},
};
