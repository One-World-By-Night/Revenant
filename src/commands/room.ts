import {
	SlashCommandBuilder,
	ChannelType,
	PermissionFlagsBits,
	MessageFlags,
	type ChatInputCommandInteraction,
	type Guild,
} from 'discord.js';
import type { BotCommand, CommandContext } from './registry.js';
import { callBe, BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale } from '../i18n/index.js';
import { fetchApprovedLinks, setRoom, fetchCapabilitiesFor, roleForCapabilities, type ApprovedLink } from '../be/rooms.js';
import { loadGuildSettings, type GuildSettingsRow } from './settings.js';

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

function findLink(links: ApprovedLink[], discordUserId: string): ApprovedLink | undefined {
	return links.find((link) => link.discord_user_id === discordUserId);
}

const ROOMS_CATEGORY_NAME = 'Player Rooms';

/**
 * The guild's own "Player Rooms" category, reused across every `/room create` call rather than
 * minted fresh each time - found by name first, created once if no category by that name exists yet.
 */
async function findOrCreateRoomsCategory(guild: Guild): Promise<string> {
	const existing = guild.channels.cache.find(
		(channel) => channel.type === ChannelType.GuildCategory && channel.name === ROOMS_CATEGORY_NAME
	);
	if (existing) {
		return existing.id;
	}
	const created = await guild.channels.create({ name: ROOMS_CATEGORY_NAME, type: ChannelType.GuildCategory });
	return created.id;
}

function roleIdFor(settings: GuildSettingsRow, role: 'storyteller' | 'narrator' | 'player'): string | null {
	if (role === 'storyteller') {
		return settings.storyteller_role_id;
	}
	if (role === 'narrator') {
		return settings.narrator_role_id;
	}
	return settings.player_role_id;
}

export const roomCommand: BotCommand = {
	data: new SlashCommandBuilder()
		.setName('room')
		.setDescription("Set a linked player's own private room")
		.setDescriptionLocalizations({ 'pt-BR': 'Define a sala privada de um jogador vinculado' })
		.addSubcommand((sub) =>
			sub
				.setName('point')
				.setDescription("Point a linked player's room at an existing channel")
				.setDescriptionLocalizations({ 'pt-BR': 'Aponta a sala de um jogador vinculado para um canal existente' })
				.addUserOption((option) =>
					option
						.setName('player')
						.setDescription('The linked player')
						.setDescriptionLocalizations({ 'pt-BR': 'O jogador vinculado' })
						.setRequired(true)
				)
				.addChannelOption((option) =>
					option
						.setName('channel')
						.setDescription("The player's existing room channel")
						.setDescriptionLocalizations({ 'pt-BR': 'O canal já existente da sala do jogador' })
						.addChannelTypes(ChannelType.GuildText)
						.setRequired(true)
				)
		)
		.addSubcommand((sub) =>
			sub
				.setName('create')
				.setDescription('Create a new private room for a linked player')
				.setDescriptionLocalizations({ 'pt-BR': 'Cria uma nova sala privada para um jogador vinculado' })
				.addUserOption((option) =>
					option
						.setName('player')
						.setDescription('The linked player')
						.setDescriptionLocalizations({ 'pt-BR': 'O jogador vinculado' })
						.setRequired(true)
				)
		)
		.addSubcommand((sub) =>
			sub
				.setName('clear')
				.setDescription("Clear a linked player's own room")
				.setDescriptionLocalizations({ 'pt-BR': 'Remove a sala de um jogador vinculado' })
				.addUserOption((option) =>
					option
						.setName('player')
						.setDescription('The linked player')
						.setDescriptionLocalizations({ 'pt-BR': 'O jogador vinculado' })
						.setRequired(true)
				)
		) as SlashCommandBuilder,

	async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
		const locale = resolveLocale(interaction.locale);
		if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
			return;
		}
		const guildId = interaction.guildId;

		const connection = await loadConnection(context, guildId);
		if (!connection) {
			await interaction.reply({ content: t(locale, 'disconnect.notConnected'), flags: MessageFlags.Ephemeral });
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const secret = decrypt(connection.secret_enc, context.config.secretKey);

		let capabilities: { capabilities: Record<string, boolean> };
		try {
			capabilities = await callBe(connection.rest_root, {
				method: 'GET',
				route: `/be/v1/${connection.game_slug}/my/capabilities`,
				signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId: interaction.user.id },
			});
		} catch (error) {
			if (error instanceof BeApiError && error.kind === 'user_not_linked') {
				await interaction.editReply(t(locale, 'shared.userNotLinked'));
				return;
			}
			context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/room failed');
			await interaction.editReply(t(locale, 'shared.unreachable'));
			return;
		}
		if (!capabilities.capabilities.be_manage_characters) {
			await interaction.editReply(t(locale, 'shared.storytellersOnly'));
			return;
		}

		const targetUser = interaction.options.getUser('player', true);

		try {
			const links = await fetchApprovedLinks(connection, secret, interaction.user.id);
			const link = findLink(links, targetUser.id);
			if (!link) {
				await interaction.editReply(t(locale, 'room.playerNotLinked', { username: targetUser.username }));
				return;
			}

			const subcommand = interaction.options.getSubcommand();

			if (subcommand === 'clear') {
				await setRoom(connection, secret, interaction.user.id, link.id, null);
				await interaction.editReply(t(locale, 'room.cleared', { username: targetUser.username }));
				return;
			}

			let channelId: string;
			if (subcommand === 'point') {
				const channel = interaction.options.getChannel('channel', true);
				channelId = channel.id;
			} else {
				const everyoneId = interaction.guild.roles.everyone.id;
				const settings = await loadGuildSettings(context, guildId);
				const overwrites = [
					{ id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
					{
						id: targetUser.id,
						allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
					},
				];
				for (const roleId of [settings.narrator_role_id, settings.storyteller_role_id]) {
					if (roleId) {
						overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
					}
				}
				const categoryId = await findOrCreateRoomsCategory(interaction.guild);
				const created = await interaction.guild.channels.create({
					name: `room-${targetUser.username}`.toLowerCase().slice(0, 90),
					type: ChannelType.GuildText,
					parent: categoryId,
					permissionOverwrites: overwrites,
				});
				channelId = created.id;
			}

			await setRoom(connection, secret, interaction.user.id, link.id, channelId);

			const settings = await loadGuildSettings(context, guildId);
			if (settings.role_sync_enabled) {
				try {
					const targetCapabilities = await fetchCapabilitiesFor(connection, secret, targetUser.id);
					const role = roleForCapabilities(targetCapabilities);
					const roleId = roleIdFor(settings, role);
					if (roleId) {
						const member = await interaction.guild.members.fetch(targetUser.id);
						await member.roles.add(roleId);
					}
				} catch (error) {
					context.logger.warn(
						{ guildId, error: error instanceof Error ? error.message : String(error) },
						'/room role sync failed'
					);
				}
			}

			await interaction.editReply(t(locale, 'room.set', { username: targetUser.username, channel: `<#${channelId}>` }));
		} catch (error) {
			if (error instanceof BeApiError && error.kind === 'user_not_linked') {
				await interaction.editReply(t(locale, 'shared.userNotLinked'));
				return;
			}
			context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/room failed');
			await interaction.editReply(t(locale, 'shared.unreachable'));
		}
	},
};
