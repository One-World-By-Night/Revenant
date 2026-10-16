import { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags, type MessageContextMenuCommandInteraction } from 'discord.js';
import type { CommandContext } from './registry.js';
import { callBe, BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale } from '../i18n/index.js';
import { findProxiedMessage } from '../posting/store.js';
import { fetchPostingProfile } from '../be/postingProfile.js';
import type { Connection } from '../be/temporaryState.js';

export interface ContextMenuCommand {
	data: ContextMenuCommandBuilder;
	execute(interaction: MessageContextMenuCommandInteraction, context: CommandContext): Promise<void>;
}

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
	site_url: string;
}

async function loadConnection(context: CommandContext, guildId: string): Promise<ConnectionRow | null> {
	const { rows } = await context.pool.query<ConnectionRow>(
		'SELECT be_connection_id, secret_enc, rest_root, game_slug, site_url FROM connections WHERE guild_id = $1',
		[guildId]
	);
	return rows[0] ?? null;
}

function whosWhoUrl(siteUrl: string, gameSlug: string): string {
	return `${siteUrl.replace(/\/+$/, '')}/be-player/?tab=whos-who&game_slug=${encodeURIComponent(gameSlug)}`;
}

export const whosWhoContextCommand: ContextMenuCommand = {
	data: new ContextMenuCommandBuilder().setName("Who's Who").setType(ApplicationCommandType.Message) as ContextMenuCommandBuilder,

	async execute(interaction: MessageContextMenuCommandInteraction, context: CommandContext): Promise<void> {
		const locale = resolveLocale(interaction.locale);
		if (!interaction.inGuild() || !interaction.guildId) {
			return;
		}
		const guildId = interaction.guildId;

		const proxied = await findProxiedMessage(context.pool, guildId, interaction.targetId);
		if (!proxied) {
			await interaction.reply({ content: t(locale, 'whosWho.notProxied'), flags: MessageFlags.Ephemeral });
			return;
		}

		const connection = await loadConnection(context, guildId);
		if (!connection) {
			await interaction.reply({ content: t(locale, 'disconnect.notConnected'), flags: MessageFlags.Ephemeral });
			return;
		}
		const secret = decrypt(connection.secret_enc, context.config.secretKey);
		const beConnection: Connection = { be_connection_id: connection.be_connection_id, rest_root: connection.rest_root, game_slug: connection.game_slug };

		let profile;
		try {
			profile = await fetchPostingProfile(beConnection, secret, proxied.discordUserId, proxied.characterId);
		} catch {
			await interaction.reply({ content: t(locale, 'whosWho.noProfile'), flags: MessageFlags.Ephemeral });
			return;
		}

		if (!profile.profile_public) {
			await interaction.reply({ content: t(locale, 'whosWho.noProfile'), flags: MessageFlags.Ephemeral });
			return;
		}

		await interaction.reply({
			content: t(locale, 'whosWho.link', { name: profile.display_name, url: whosWhoUrl(connection.site_url, connection.game_slug) }),
			flags: MessageFlags.Ephemeral,
		});
	},
};

export const whoPostedThisContextCommand: ContextMenuCommand = {
	data: new ContextMenuCommandBuilder().setName('Who posted this?').setType(ApplicationCommandType.Message) as ContextMenuCommandBuilder,

	async execute(interaction: MessageContextMenuCommandInteraction, context: CommandContext): Promise<void> {
		const locale = resolveLocale(interaction.locale);
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

		let capabilities: { capabilities: Record<string, boolean> };
		try {
			capabilities = await callBe(connection.rest_root, {
				method: 'GET',
				route: `/be/v1/${connection.game_slug}/my/capabilities`,
				signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId: interaction.user.id },
			});
		} catch (error) {
			if (error instanceof BeApiError && error.kind === 'user_not_linked') {
				await interaction.reply({ content: t(locale, 'shared.userNotLinked'), flags: MessageFlags.Ephemeral });
				return;
			}
			await interaction.reply({ content: t(locale, 'shared.unreachable'), flags: MessageFlags.Ephemeral });
			return;
		}
		if (!capabilities.capabilities.be_manage_characters) {
			await interaction.reply({ content: t(locale, 'shared.storytellersOnly'), flags: MessageFlags.Ephemeral });
			return;
		}

		const proxied = await findProxiedMessage(context.pool, guildId, interaction.targetId);
		if (!proxied) {
			await interaction.reply({ content: t(locale, 'whoPostedThis.notProxied'), flags: MessageFlags.Ephemeral });
			return;
		}

		const beConnection: Connection = { be_connection_id: connection.be_connection_id, rest_root: connection.rest_root, game_slug: connection.game_slug };
		let displayName = `#${proxied.characterId}`;
		try {
			const profile = await fetchPostingProfile(beConnection, secret, proxied.discordUserId, proxied.characterId);
			displayName = profile.display_name;
		} catch {
			/* fall back to the bare character id below */
		}

		const user = await interaction.client.users.fetch(proxied.discordUserId).catch(() => null);
		await interaction.reply({
			content: t(locale, 'whoPostedThis.result', { username: user?.username ?? proxied.discordUserId, name: displayName }),
			flags: MessageFlags.Ephemeral,
		});
	},
};

export const contextMenuCommands: ContextMenuCommand[] = [whosWhoContextCommand, whoPostedThisContextCommand];

export function findContextMenuCommand(name: string): ContextMenuCommand | undefined {
	return contextMenuCommands.find((command) => command.data.name === name);
}
