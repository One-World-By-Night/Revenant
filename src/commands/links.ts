import {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	type ChatInputCommandInteraction,
	type ButtonInteraction,
} from 'discord.js';
import type { CommandContext } from './registry.js';
import { callBe, BeApiError } from '../be/client.js';
import { decrypt } from '../crypto/secretBox.js';
import { t, resolveLocale, type Locale } from '../i18n/index.js';

const COLLECTOR_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ROWS_SHOWN = 5;

export type LinksStatus = 'confirmed' | 'approved';
export type LinksButtonAction = 'approve' | 'decline' | 'revoke';

export interface LinkRow {
	id: number;
	discord_username: string;
	characters: Array<{ id: number; name: string }>;
}

interface ConnectionRow {
	be_connection_id: number;
	secret_enc: Buffer;
	rest_root: string;
	game_slug: string;
}

/**
 * Parses a `links:{action}:{id}` button custom id, or null when it isn't one of this command's own.
 */
export function parseLinksButtonId(customId: string): { action: LinksButtonAction; linkId: number } | null {
	const match = /^links:(approve|decline|revoke):(\d+)$/.exec(customId);
	if (!match || !match[1] || !match[2]) {
		return null;
	}
	return { action: match[1] as LinksButtonAction, linkId: Number(match[2]) };
}

function characterNames(link: LinkRow): string {
	return link.characters.map((character) => character.name).join(', ') || '—';
}

/**
 * Builds the ephemeral message for a status view: the list text and up to `MAX_ROWS_SHOWN` rows of
 * per-link action buttons, newest-omitted-first when there are more than fit.
 */
export function renderLinksList(
	locale: Locale,
	status: LinksStatus,
	links: LinkRow[]
): { content: string; components: ActionRowBuilder<ButtonBuilder>[] } {
	if (links.length === 0) {
		return { content: t(locale, status === 'confirmed' ? 'links.noneConfirmed' : 'links.noneApproved'), components: [] };
	}

	const shown = links.slice(0, MAX_ROWS_SHOWN);
	const lines = shown.map((link) => t(locale, 'links.row', { username: link.discord_username, characters: characterNames(link) }));
	const remaining = links.length - shown.length;
	const content = remaining > 0 ? `${lines.join('\n')}\n\n+${remaining}` : lines.join('\n');

	const components = shown.map((link) => {
		if (status === 'confirmed') {
			return new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(`links:approve:${link.id}`)
					.setLabel(t(locale, 'links.approveButton'))
					.setStyle(ButtonStyle.Success),
				new ButtonBuilder()
					.setCustomId(`links:decline:${link.id}`)
					.setLabel(t(locale, 'links.declineButton'))
					.setStyle(ButtonStyle.Danger)
			);
		}
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`links:revoke:${link.id}`).setLabel(t(locale, 'links.revokeButton')).setStyle(ButtonStyle.Danger)
		);
	});

	return { content, components };
}

async function fetchList(
	connection: ConnectionRow,
	secret: Buffer,
	discordUserId: string,
	status: LinksStatus
): Promise<LinkRow[]> {
	return callBe<LinkRow[]>(connection.rest_root, {
		method: 'GET',
		route: `/be/v1/${connection.game_slug}/discord-links`,
		query: { status },
		signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId },
	});
}

export const linksCommand = {
	data: new SlashCommandBuilder()
		.setName('links')
		.setDescription("Review this chronicle's Discord link requests")
		.setDescriptionLocalizations({ 'pt-BR': 'Revisa os pedidos de vínculo do Discord desta crônica' })
		.addStringOption((option) =>
			option
				.setName('status')
				.setDescription('Which links to show')
				.setDescriptionLocalizations({ 'pt-BR': 'Quais vínculos mostrar' })
				.addChoices(
					{ name: 'Waiting for an answer', value: 'confirmed', name_localizations: { 'pt-BR': 'Esperando resposta' } },
					{ name: 'Approved', value: 'approved', name_localizations: { 'pt-BR': 'Aprovados' } }
				)
		) as SlashCommandBuilder,

	async execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
		const locale = resolveLocale(interaction.locale);
		if (!interaction.inGuild() || !interaction.guildId) {
			return;
		}
		const guildId = interaction.guildId;
		const status = (interaction.options.getString('status') ?? 'confirmed') as LinksStatus;

		await interaction.deferReply({ ephemeral: true });

		const { rows } = await context.pool.query<ConnectionRow>(
			'SELECT be_connection_id, secret_enc, rest_root, game_slug FROM connections WHERE guild_id = $1',
			[guildId]
		);
		const connectionRow = rows[0];
		if (!connectionRow) {
			await interaction.editReply(t(locale, 'disconnect.notConnected'));
			return;
		}
		const connection: ConnectionRow = connectionRow;

		const secret = decrypt(connection.secret_enc, context.config.secretKey);

		async function renderCurrent(): Promise<{ content: string; components: ActionRowBuilder<ButtonBuilder>[] } | null> {
			try {
				const links = await fetchList(connection, secret, interaction.user.id, status);
				return renderLinksList(locale, status, links);
			} catch (error) {
				if (error instanceof BeApiError && error.httpStatus === 403) {
					return { content: t(locale, 'shared.storytellersOnly'), components: [] };
				}
				context.logger.warn({ guildId, error: error instanceof Error ? error.message : String(error) }, '/links failed');
				return null;
			}
		}

		const view = await renderCurrent();
		if (!view) {
			await interaction.editReply(t(locale, 'shared.unreachable'));
			return;
		}
		const message = await interaction.editReply({ content: view.content, components: view.components });
		if (view.components.length === 0) {
			return;
		}

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			filter: (i) => i.user.id === interaction.user.id,
			time: COLLECTOR_TIMEOUT_MS,
		});

		collector.on('collect', (buttonInteraction: ButtonInteraction) => {
			void handleClick(buttonInteraction);
		});

		collector.on('end', () => {
			interaction.editReply({ components: [] }).catch(() => undefined);
		});

		async function handleClick(buttonInteraction: ButtonInteraction): Promise<void> {
			const parsed = parseLinksButtonId(buttonInteraction.customId);
			if (!parsed) {
				return;
			}
			await buttonInteraction.deferUpdate();

			const route = `/be/v1/${connection.game_slug}/discord-links/${parsed.linkId}/${parsed.action}`;
			try {
				await callBe(connection.rest_root, {
					method: 'POST',
					route,
					signedAs: { connectionId: String(connection.be_connection_id), secret, discordUserId: buttonInteraction.user.id },
				});
			} catch (error) {
				context.logger.warn(
					{ guildId, action: parsed.action, error: error instanceof Error ? error.message : String(error) },
					'/links action failed'
				);
			}

			const refreshed = await renderCurrent();
			if (refreshed) {
				await interaction.editReply({ content: refreshed.content, components: refreshed.components });
			}
		}
	},
};
