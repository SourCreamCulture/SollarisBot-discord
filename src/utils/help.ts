import { EmbedBuilder } from 'discord.js';
import type { CommandModule } from '../types/bot';

const categories: Record<string, string[]> = {
  music: ['play', 'player', 'queue', 'library', 'music'],
  games: ['apex', 'valorant'],
  utilities: ['event', 'poll', 'remind', 'roll'],
  admin: ['bot', 'settings'],
};

export const buildHelpEmbed = (
  commands: CommandModule[],
  category = 'all',
): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor(0x4f9eed)
    .setTitle('SollarisBot Help');
  if (category === 'all') {
    embed.setDescription(
      'Choose a category with `/bot help category:…` for the full command list.',
    );
    for (const [name, names] of Object.entries(categories)) {
      embed.addFields({
        name: name[0].toUpperCase() + name.slice(1),
        value: commands
          .filter((c) => names.includes(c.data.name))
          .map((c) => `\`/${c.data.name}\` — ${c.data.toJSON().description}`)
          .join('\n'),
      });
    }
    embed.addFields({
      name: 'Start here',
      value:
        '`/play now query:…` · `/event create` · `/valorant lfg` · `/apex lfg`\nAdmins: `/settings view` and `/music settings view`',
    });
  } else {
    embed.setDescription(
      `Available ${category} commands. Discord’s command picker shows each command’s options.`,
    );
    for (const command of commands.filter((c) =>
      categories[category]?.includes(c.data.name),
    )) {
      const json = command.data.toJSON();
      const paths: string[] = [];
      for (const option of json.options ?? []) {
        if (option.type === 1) paths.push(`\`/${json.name} ${option.name}\``);
        if (option.type === 2)
          for (const sub of option.options ?? [])
            paths.push(`\`/${json.name} ${option.name} ${sub.name}\``);
      }
      if (!paths.length) paths.push(`\`/${json.name}\` — ${json.description}`);
      let chunk = '';
      let part = 1;
      for (const path of paths) {
        if (chunk.length + path.length + 1 > 1000) {
          embed.addFields({ name: `/${json.name} (${part++})`, value: chunk });
          chunk = '';
        }
        chunk += `${chunk ? '\n' : ''}${path}`;
      }
      if (chunk)
        embed.addFields({
          name: `/${json.name}${part > 1 ? ` (${part})` : ''}`,
          value: chunk,
        });
    }
  }
  return embed.setFooter({
    text: 'Channels and roles are configured per server. Manage Server permission is required to change settings.',
  });
};
