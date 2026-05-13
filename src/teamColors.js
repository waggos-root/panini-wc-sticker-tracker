// Two dominant flag colors per team, rendered as a soft 135° gradient behind
// each team's sticker grid in the Álbum view. Order matches the album group
// order in server/album-data.js — keep these in sync if team names change.
export const TEAM_COLORS = {
  // Group A
  'Mexico': ['#006847', '#ce1126'],
  'South Africa': ['#007a4d', '#ffb612'],
  'South Korea': ['#cd2e3a', '#0047a0'],
  'Czechia': ['#11457e', '#d7141a'],
  // Group B
  'Canada': ['#d52b1e', '#ffffff'],
  'Bosnia and Herzegovina': ['#002395', '#fecb00'],
  'Qatar': ['#8a1538', '#ffffff'],
  'Switzerland': ['#d52b1e', '#ffffff'],
  // Group C
  'Brazil': ['#009c3b', '#ffdf00'],
  'Morocco': ['#c1272d', '#006233'],
  'Haiti': ['#00209f', '#d21034'],
  'Scotland': ['#0065bd', '#ffffff'],
  // Group D
  'USA': ['#3c3b6e', '#b22234'],
  'Paraguay': ['#d52b1e', '#0038a8'],
  'Australia': ['#012169', '#e4002b'],
  'Türkiye': ['#e30a17', '#ffffff'],
  // Group E
  'Germany': ['#000000', '#dd0000'],
  'Curaçao': ['#002b7f', '#f9e814'],
  'Ivory Coast': ['#ff8200', '#009e60'],
  'Ecuador': ['#ffdd00', '#034ea2'],
  // Group F
  'Netherlands': ['#ae1c28', '#21468b'],
  'Japan': ['#bc002d', '#ffffff'],
  'Sweden': ['#006aa7', '#fecc00'],
  'Tunisia': ['#e70013', '#ffffff'],
  // Group G
  'Belgium': ['#000000', '#fae042'],
  'Egypt': ['#ce1126', '#000000'],
  'Iran': ['#239f40', '#da0000'],
  'New Zealand': ['#012169', '#cc142b'],
  // Group H
  'Spain': ['#aa151b', '#f1bf00'],
  'Cape Verde': ['#003893', '#cf2027'],
  'Saudi Arabia': ['#006c35', '#ffffff'],
  'Uruguay': ['#0038a8', '#ffffff'],
  // Group I
  'France': ['#0055a4', '#ef4135'],
  'Senegal': ['#00853f', '#e31b23'],
  'Iraq': ['#cd2027', '#000000'],
  'Norway': ['#ef2b2d', '#002868'],
  // Group J
  'Argentina': ['#74acdf', '#ffffff'],
  'Algeria': ['#006233', '#ffffff'],
  'Austria': ['#ed2939', '#ffffff'],
  'Jordan': ['#000000', '#007a3d'],
  // Group K
  'Portugal': ['#006600', '#ff0000'],
  'Congo DR': ['#007fff', '#f7d618'],
  'Uzbekistan': ['#0099b5', '#1eb53a'],
  'Colombia': ['#fcd116', '#003893'],
  // Group L
  'England': ['#ffffff', '#ce1124'],
  'Croatia': ['#171796', '#ff0000'],
  'Ghana': ['#006b3f', '#fcd116'],
  'Panama': ['#005293', '#d21034'],
};

export function teamGradient(team) {
  const colors = TEAM_COLORS[team];
  if (!colors) return undefined;
  // 55 = 33% alpha — strong enough to be recognisable, light enough that
  // the white sticker cards inside still pop.
  return `linear-gradient(135deg, ${colors[0]}55, ${colors[1]}55)`;
}
