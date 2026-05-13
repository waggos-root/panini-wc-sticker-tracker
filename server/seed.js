import { introStickers, teamCodes, teams, worldCupHistory } from './album-data.js';

export function teamCode(team) {
  const code = teamCodes[team];
  if (!code) {
    throw new Error(`Missing FIFA code for team: ${team}`);
  }
  return code;
}

export function buildStickerSeed() {
  const intro = introStickers.map((entry) => ({
    code: entry.code,
    name: entry.name,
    section: 'Misceláneos',
    team: null,
    type: 'intro',
    source: 'pack',
    team_order: null,
  }));

  const history = worldCupHistory.map((entry) => ({
    code: entry.code,
    name: entry.name,
    section: 'World Cup History',
    team: null,
    type: 'museum',
    source: 'pack',
    team_order: null,
  }));

  const countries = teams.flatMap((team, teamIndex) => {
    const code = teamCode(team);

    return Array.from({ length: 20 }).map((_, index) => {
      const position = index + 1;
      let name;
      if (position === 1) {
        name = 'Team Logo';
      } else if (position === 13) {
        name = 'Team Photo';
      } else {
        const playerNumber = position < 13 ? position - 1 : position - 2;
        name = `Player ${playerNumber}`;
      }

      return {
        code: `${code}${position}`,
        name,
        section: 'Selecciones',
        team,
        type: 'country',
        source: 'pack',
        team_order: teamIndex,
      };
    });
  });

  return [...intro, ...history, ...countries];
}
