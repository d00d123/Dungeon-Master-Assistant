/* Demo campaign "The Drowned Bell": an original coastal-horror campaign that fills every part of the board,
   with a fight in progress. Sets window.DMB_DATA.demoBoard(h), a factory that returns a fresh board object.
   h = { uid, today, S } from js/app.js (id generator, date helper, current board for the DM name).
   Used by: js/app.js demoBoard() (first run and Campaign > Load demo). */
window.DMB_DATA = window.DMB_DATA || {};
window.DMB_DATA.demoBoard = function(h){
const {uid,today,S} = h;
  const id=()=>uid(),now=Date.now(),P={},N={},C={},M={};
  ['bran','iso','kes','oru','pip'].forEach(k=>P[k]=id());['edda','ald','silt','tam','marr'].forEach(k=>N[k]=id());['tide','dock','oil'].forEach(k=>C[k]=id());['bell','lamp'].forEach(k=>M[k]=id());
  const sl=(a)=>Array.from({length:9},(_,i)=>a[i]||0);
  const players=[
    {id:P.bran,name:'Brannoc Tidewell',player:'Sam',cls:'Fighter',level:4,maxHp:44,hp:31,ac:18,ini:1,pp:12,pins:11,pinv:10,spd:30,xp:3100,hdu:1,insp:true,conditions:[],notes:'Ex-navy. Shield bears the sign of the drowned fleet.',
      hooks:{goal:'Find out who scuttled his old ship',bond:'His sister Nell, a net-mender in Saltreach',fear:'Drowning in the dark',secret:'He deserted the night the fleet went down'},mods:{Athletics:6,Perception:2,STR:5,CON:4}},
    {id:P.iso,name:'Isolde Venn',player:'Jo',cls:'Wizard',level:4,maxHp:26,hp:26,ac:13,ini:3,pp:11,pins:13,pinv:15,sdc:14,spd:30,xp:3100,conditions:[],notes:'Collects bell-founders’ marks. Lantern-bearer.',
      hooks:{goal:'Read the hymn carved inside the Drowned Bell',bond:'Her mentor’s unfinished atlas',fear:'Silence',secret:'She answered the Choir’s song once, in a dream'},slots:sl([4,3]),sused:sl([2,1]),mods:{Arcana:6,History:6,INT:4}},
    {id:P.kes,name:'Kestrel',player:'Priya',cls:'Ranger',level:4,maxHp:36,hp:9,ac:15,ini:4,pp:16,pins:14,pinv:11,spd:35,xp:3100,conditions:['Poisoned'],notes:'Tracks by tide-line. Owes Tam a boat.',
      hooks:{goal:'Pay back Tam for the boat she sank',bond:'Her hawk, Brine',fear:'Cages',secret:'Her mother leads the wreckers on Gull Rock'},slots:sl([3]),sused:sl([1]),mods:{Survival:5,Stealth:7,DEX:4}},
    {id:P.oru,name:'Oru Ashmantle',player:'Marcus',cls:'Cleric',level:4,maxHp:31,hp:12,ac:18,ini:-1,pp:15,pins:15,pinv:10,sdc:13,spd:25,xp:3100,hdu:2,conditions:['Paralyzed'],notes:'Priest of the dawn. Rings a hand-bell at every grave.',
      hooks:{goal:'Reconsecrate the sunken chapel',bond:'Father Aldous, who trained him',fear:'Undeath',secret:'Aldous asked him to hide the chapel’s records'},slots:sl([4,3]),sused:sl([3,1]),mods:{Religion:4,Medicine:5,WIS:5}},
    {id:P.pip,name:'Pip Thistledown',player:'Lee',cls:'Bard',level:4,maxHp:27,hp:27,ac:14,ini:3,pp:13,pins:15,pinv:11,sdc:13,spd:25,xp:3100,present:false,conditions:[],notes:'Away tonight. Owes three taverns a song.',
      hooks:{goal:'Write the ballad that makes him famous',bond:'The Gull & Lantern’s cook',fear:'Being forgotten',secret:'He stole the reliquary and sold it to Mother Silt'},slots:sl([4,3]),sused:sl([0,0]),mods:{Persuasion:7,Performance:7,CHA:4}}];
  const pc=(k,init)=>({id:id(),pid:P[k],name:players.find(p=>p.id===P[k]).name,ini:players.find(p=>p.id===P[k]).ini,init,ds:{s:0,f:0}});
  const foe=(name,base,hp,max,ac,ini,xp,init,x)=>Object.assign({id:id(),base,name,maxHp:max,hp,ac,ini,xp,conditions:[],init},x||{});
  const fight=[pc('kes',19),foe('Mother Silt','Cultist Fanatic',30,44,13,2,450,17),pc('iso',15),foe('Ghoul','Ghoul',22,22,12,2,200,14),pc('bran',12),foe('Cultist 1','Cultist',9,9,12,1,25,10),foe('Cultist 2','Cultist',2,9,12,1,25,10,{conditions:['Prone']}),pc('oru',6)];
  const turn=3;
  return {example:false,
    dm:{name:(S&&S.dm&&S.dm.name)||'Dungeon Master',campaign:'The Drowned Bell (demo)',session:3,lastBackup:today(),wander:8,gritty:false,injuries:true,dturn:14},
    players,
    battles:[
      {id:id(),name:'Wreckers on the shingle',date:today(),session:2,active:false,round:4,turn:0,combatants:[],log:['Round 1 begins. Kestrel acts first.','Brannoc drops the wrecker captain with a crit.','The last two wreckers flee into the fog.'],outcome:'Victory',xp:600,gone:[{name:'Bandit Captain',xp:450},{name:'Bandit 1',xp:25},{name:'Bandit 2',xp:25}]},
      {id:id(),name:'Cultists in the bell tower',date:today(),session:3,active:true,round:2,turn,reach:2000+turn,combatants:fight,goal:'Stop Mother Silt ringing the bell',lose:'The bell tolls and the drowned rise in the harbour',
        events:[{r:3,text:'The bell sways: everyone makes a DC 12 Wisdom save or is Frightened until the end of their next turn'},{r:5,text:'The rotten floor gives way under the heaviest creature'}],
        log:['Round 1 begins. Kestrel acts first.','R1: Kestrel hits Mother Silt for 8 damage','R1: Ghoul claws Oru Ashmantle: Paralyzed','R1: Brannoc knocks Cultist 2 prone and hits for 7 damage','Round 2 begins.','R2: Kestrel takes 6 poison damage from the Ghoul’s bite'],outcome:'',xp:0}],
    missions:[
      {id:M.bell,title:'Silence the Drowned Bell',giver:'Harbourmaster Edda Coyle',where:'The bell tower',reward:'200 gp and a berth on any ship',status:'active',notes:'The bell rang by itself three nights ago. Since then, fishermen hear singing under the water.',
        clues:[{text:'Wet footprints climb the tower stairs at low tide',src:'Tam Brisket',found:true},{text:'The bell was recast with silver from the sunken chapel',src:'Temple records',found:false},{text:'The cult meets when the fog rolls in',src:'A cultist’s note',found:true}],
        due:{day:6,min:1320},ifIgnored:'At the spring tide the bell tolls and the drowned walk into Saltreach.'},
      {id:M.lamp,title:'Find the missing lamplighter',giver:'Widow Marr',where:'Saltreach docks',reward:'Her late husband’s silvered dagger',status:'active',notes:'Old Corwin Marr hasn’t lit the harbour lamps for two nights.',clues:[{text:'Corwin’s ladder was left by the chapel steps',src:'Widow Marr',found:true}]},
      {id:id(),title:'Escort the salt barge to Saltreach',giver:'Guild of Salters',where:'Mistmarsh canal',reward:'50 gp',status:'done',notes:''},
      {id:id(),title:'Recover the chapel reliquary',giver:'Father Aldous Penhale',where:'Unknown',reward:'The temple’s favour',status:'hold',notes:'Aldous won’t say who had it last.'}],
    loot:[{id:id(),item:'Potion of healing',holder:'Oru Ashmantle',value:'50 gp',session:2},{id:id(),item:'Silvered dagger',holder:'Kestrel',value:'2 gp',session:2},{id:id(),item:'Tide chart of the Saltreach shoals',holder:'Party',value:'',session:2},{id:id(),item:'Wrecker captain’s spyglass',holder:'Brannoc Tidewell',value:'1000 gp',session:2}],
    purse:{cp:80,sp:45,ep:0,gp:312,pp:2},
    notes:[
      {id:id(),date:today(),title:'Session 1 recap',body:'The party brought the salt barge through the Mistmarsh and met Harbourmaster Coyle. That night the Drowned Bell rang on its own. Oru heard singing under the pier.'},
      {id:id(),date:today(),title:'Session 2 recap',body:'Wreckers lured a ship onto Gull Rock. The party fought them on the shingle and took the captain’s spyglass. Kestrel recognised one of the wreckers and said nothing. A note on a dead cultist named the bell tower.'}],
    npcs:[
      {id:N.edda,name:'Edda Coyle',role:'Harbourmaster',where:'Saltreach harbour',attitude:'Friendly',voice:'Clipped, sailor’s slang, never sits down',wants:'Ships back in the harbour before the guild replaces her',knows:'Three ships have gone missing near Gull Rock this season.',last:2,notes:''},
      {id:N.ald,name:'Father Aldous Penhale',role:'Priest of the dawn',where:'Temple of the First Light',attitude:'Indifferent',voice:'Soft, answers questions with questions',wants:'The chapel records to stay buried',knows:'Who recast the bell, and why.',last:1,notes:'Trained Oru.'},
      {id:N.silt,name:'Mother Silt',role:'Choir of the Deep, high singer',where:'The bell tower',attitude:'Hostile',voice:'Sings every sentence, smells of brine',wants:'To ring the bell at the spring tide',knows:'Where the reliquary is now.',last:3,notes:''},
      {id:N.tam,name:'Tam Brisket',role:'Fisher',where:'Saltreach docks',attitude:'Friendly',voice:'Loud, laughs at his own jokes',wants:'A new boat, from Kestrel',knows:'The tides, and who goes out at night.',last:2,notes:''},
      {id:N.marr,name:'Widow Marr',role:'Chandler',where:'Marr’s Candles',attitude:'Unknown',voice:'Whispers, fusses with candle wicks',wants:'Her husband home',knows:'Corwin owed the cult money.',last:1,notes:''}],
    places:[
      {id:id(),name:'Saltreach',kind:'Town',notes:'Fishing town on stilts over the tide flats. Fog most evenings.'},
      {id:id(),name:'The bell tower',kind:'Building',notes:'Leaning stone tower above the harbour. The bell hangs over a rotten floor.'},
      {id:id(),name:'The sunken chapel',kind:'Dungeon',notes:'Reachable only at low tide. Half the nave is underwater.'},
      {id:id(),name:'Gull Rock',kind:'Landmark',notes:'Wreckers light false beacons here.'},
      {id:id(),name:'The Mistmarsh',kind:'Wilderness',notes:'Salt marsh and canals inland of town.'}],
    secrets:[
      {id:id(),text:'Father Aldous recast the bell with chapel silver to hide the theft of the reliquary.',revealed:false,link:`npc:${N.ald}`,tonight:true},
      {id:id(),text:'Corwin Marr is alive, chained under the chapel as the Choir’s next offering.',revealed:false,link:`npc:${N.marr}`,tonight:true},
      {id:id(),text:'Mother Silt was once a priest of the dawn.',revealed:false,link:`npc:${N.silt}`},
      {id:id(),text:'The wreckers sell salvage to the cult.',revealed:true,rsess:2,link:`npc:${N.tam}`}],
    scenes:[
      {id:id(),title:'Fight in the bell tower',kind:'Combat',goal:'Stop the ritual before round 5',read:'The stairs open onto a platform of wet planks. Above you the great bell sways, though there is no wind, and a woman in a dripping robe is singing to it.',done:false},
      {id:id(),title:'Aldous at the temple',kind:'Social',goal:'Make the party doubt the priest',read:'',done:false},
      {id:id(),title:'Low tide at the chapel',kind:'Exploration',goal:'Find a way in before the water returns',read:'The sea pulls back and the chapel roof rises out of the mud, barnacled and black.',done:false},
      {id:id(),title:'Arrive at Saltreach',kind:'Social',goal:'Meet Edda and hear the bell',read:'',done:true}],
    clocks:[
      {id:C.tide,name:'The spring tide comes',size:8,fill:5,tick:'day',cons:'The bell can be rung to wake the drowned.'},
      {id:C.dock,name:'The Choir recruits the dockhands',size:6,fill:2,tick:'none',cons:'The docks belong to the cult, and no ship will sail.'},
      {id:C.oil,name:'Harbour lamps go dark',size:4,fill:3,tick:'hour',cons:'A ship runs onto Gull Rock.'}],
    fronts:[
      {id:id(),name:'The Choir of the Deep',kind:'Campaign',goal:'Wake what sleeps under the bay by ringing the Drowned Bell at the spring tide.',doom:'The drowned walk into Saltreach and the town is given to the sea.',clock:C.tide,mission:M.bell,
        cast:[{name:'Mother Silt',impulse:'sing until something answers'},{name:'The drowned',impulse:'drag the living down'},{name:'Father Aldous',impulse:'bury his own sin'}],
        portents:[{text:'The bell rings on its own',done:true,day:1},{text:'Fishermen hear singing under the water',done:true,day:2},{text:'The lamplighter goes missing',done:true,day:3},{text:'Fog does not lift for a whole day'},{text:'The dead in the churchyard turn face-down'}],
        stakes:[{q:'Will Isolde answer the Choir’s song?'},{q:'Does Aldous confess before the tide?'}]},
      {id:id(),name:'The Gull Rock wreckers',kind:'Adventure',goal:'Keep the salvage flowing, whoever pays for it.',doom:'Every ship in the harbour is lured onto the rocks.',clock:C.oil,
        cast:[{name:'Kestrel’s mother, “the Gull”',impulse:'protect her crew at any price'}],portents:[{text:'A false beacon is seen on Gull Rock',done:true,day:2},{text:'The harbour lamps go dark'}],stakes:[{q:'Will Kestrel tell the party who leads the wreckers?'}]}],
    plans:[{id:id(),name:'Drowned chapel nave',goal:'Reach the altar before the tide returns',lose:'The water rises and the party is cut off',events:[{r:4,text:'The tide starts to return: difficult terrain everywhere'}],
      foes:[{base:'Zombie',count:4,hp:15,ac:8,ini:-2,xp:50},{base:'Specter',count:1,hp:22,ac:12,ini:2,xp:200}]}],
    handouts:[{id:id(),title:'Note found on a cultist',body:'When the fog is thick and the tide is low, climb to the bell and sing. Mother Silt will lead the hymn. Bring the lamplighter.',img:null,shown:2}],
    time:{day:4,min:1290,weather:'Thick fog rolling in off the sea'},
    lights:[{id:id(),name:'Torch',min:40,max:60},{id:id(),name:'Isolde’s lantern',min:300,max:360}],
    tonight:{started:now-80*6e4,t0:{day:4,min:1170},log:[
      {id:id(),at:now-78*6e4,day:4,min:1170,text:'Session 3 started',auto:true},
      {id:id(),at:now-60*6e4,day:4,min:1200,text:'Aldous refused to open the temple archive'},
      {id:id(),at:now-35*6e4,day:4,min:1260,text:'Kestrel spotted a false beacon on Gull Rock'},
      {id:id(),at:now-12*6e4,day:4,min:1290,text:'Battle started: Cultists in the bell tower',auto:true}]}};
};
