/* Rules reference text: the 2024 conditions (short summaries in our own words; SRD 5.2.1, CC-BY-4.0).
   Sets window.DMB_DATA.rules = { conditions, conditionText }.
   Used by: js/app.js (CONDITIONS, COND_TEXT). */
window.DMB_DATA = window.DMB_DATA || {};
window.DMB_DATA.rules = {
conditions: ['Blinded','Charmed','Deafened','Frightened','Grappled','Incapacitated','Invisible','Paralyzed','Petrified','Poisoned','Prone','Restrained','Stunned','Unconscious','Concentrating'],
conditionText: {
  Blinded:'Can’t see and fails any check that needs sight. Attack rolls against it have advantage; its own attack rolls have disadvantage.',
  Charmed:'Can’t attack the charmer or target it with damaging abilities or magic. The charmer has advantage on checks to interact socially with it.',
  Deafened:'Can’t hear and fails any check that needs hearing.',
  Frightened:'Disadvantage on ability checks and attack rolls while the source of fear is in line of sight. Can’t willingly move closer to it.',
  Grappled:'Speed 0. Disadvantage on attack rolls against anyone other than the grappler. The grappler can drag or carry it.',
  Incapacitated:'Can’t take actions, Bonus Actions or Reactions, and can’t speak. Concentration is broken. Disadvantage on initiative if incapacitated when rolling.',
  Invisible:'Advantage on initiative. Unaffected by anything that needs to see its target. Its attack rolls have advantage, and attack rolls against it have disadvantage, unless the other creature can see it.',
  Paralyzed:'Incapacitated, Speed 0. Fails STR and DEX saves. Attack rolls against it have advantage, and hits from within 5 ft are critical hits.',
  Petrified:'Turned to stone: incapacitated, Speed 0. Fails STR and DEX saves, attack rolls against it have advantage, resistant to all damage, immune to Poisoned.',
  Poisoned:'Disadvantage on attack rolls and ability checks.',
  Prone:'Can only crawl, or spend half its Speed to stand up. Its attack rolls have disadvantage. Attacks against it have advantage within 5 ft, disadvantage beyond.',
  Restrained:'Speed 0. Its attack rolls and DEX saves have disadvantage; attack rolls against it have advantage.',
  Stunned:'Incapacitated. Fails STR and DEX saves. Attack rolls against it have advantage.',
  Unconscious:'Incapacitated and Prone, Speed 0, drops what it holds, unaware of its surroundings, and still Prone when it wakes. Fails STR and DEX saves. Attack rolls against it have advantage; hits within 5 ft are critical hits.',
  Exhaustion:'Six cumulative levels. Each level gives −2 to every D20 Test and reduces Speed by 5 ft. Level 6 is death. A Long Rest removes one level.',
  Concentrating:'Taking damage forces a CON save: DC 10 or half the damage taken, whichever is higher (max DC 30). Being incapacitated or dying ends it.'
}
};
