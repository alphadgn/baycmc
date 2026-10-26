/**
 * Mudwater: Swamp Origins — live-catalogue card data supplied by the
 * operator (2026-10-26). Printed card numbers 1–120 were checked
 * individually; north/east/south/west strengths come from the live
 * catalogue (top = north, right = east, bottom = south, left = west).
 *
 * The live catalogue differs from some rulebook examples; this dataset is
 * used consistently and pinned by CATALOG_VERSION. It is not
 * publisher-certified parity with every physical edition.
 *
 * Parsed and validated by catalog.ts at load time — a malformed row throws.
 */
export const CATALOG_CSV = `number,name,family,rarity,level,north,east,south,west
1,Bottle Rocket,CLUB,Common,1,2,4,3,2
2,Sea Dog,CLUB,Common,1,3,2,3,3
3,The Deckhand,CLUB,Common,1,2,2,4,2
4,The Boathouse,CLUB,Common,1,3,2,2,2
5,Dead Calm,CLUB,Uncommon,2,4,3,3,6
6,The Dive,CLUB,Uncommon,2,4,4,3,4
7,Clubhouse Wake,CLUB,Uncommon,2,3,3,3,4
8,Lofi on the Dock,CLUB,Prestige,4,8,8,3,7
9,The Skipper,CLUB,Rare,3,5,6,5,5
10,Off Duty,CLUB,Common,1,2,2,2,2
11,The Drowned Captain,CLUB,Common,1,2,3,3,3
12,Good Seats,CLUB,Common,1,2,2,2,2
13,The Blue Voyage,CLUB,Uncommon,2,4,5,4,4
14,Members Only,CLUB,Common,1,2,3,3,3
15,The Lighter,CLUB,Common,1,2,3,3,2
16,Havana Gold,CLUB,Common,1,3,2,2,2
17,The Ante,CLUB,Common,1,2,2,3,2
18,Neon Bronco,CLUB,Common,1,2,2,2,2
19,The Captain,CLUB,Uncommon,2,4,4,3,5
20,The Parlor Regular,CLUB,Uncommon,2,4,3,5,4
21,Hot Table,CLUB,Prestige,4,3,8,8,7
22,Last Call,CLUB,Prestige,4,7,7,9,3
23,Face Card,CLUB,Common,1,2,2,2,2
24,Four of a Kind,CLUB,Common,1,2,2,2,2
25,The Getaway,CLUB,Common,1,2,3,3,3
26,Bored Stiff,CLUB,Common,1,4,1,1,4
27,Couch Lock,CLUB,Common,1,2,2,2,3
28,The Back Room,CLUB,Common,1,2,3,2,2
29,The Arcade,CLUB,Uncommon,2,4,5,4,4
30,Book of Apes,CLUB,Uncommon,2,3,5,3,5
31,Golden Stacks,CLUB,Uncommon,2,4,4,4,4
32,The Game Room,CLUB,Common,1,2,3,3,3
33,Swinging Doors,CLUB,Prestige,4,3,8,8,7
34,Bored at the Door,CLUB,Rare,3,5,5,5,5
35,Basement Anchor,CLUB,Common,1,3,3,2,3
36,The Shortcut,CLUB,Uncommon,2,4,4,5,4
37,Away Game,CLUB,Uncommon,2,4,4,5,3
38,Bored & Loathing,CLUB,Rare,3,7,3,7,5
39,Cold Summit,CLUB,Common,1,2,2,2,2
40,The Moai,CLUB,Uncommon,2,4,4,3,4
41,Late Nightcap,CLUB,Rare,3,5,5,8,4
42,Lion Dance,CLUB,Rare,3,5,5,8,4
43,Sick Day,CLUB,Common,1,3,3,2,2
44,Bored Monday,CLUB,Common,1,2,3,2,2
45,Dead to the World,CLUB,Uncommon,2,5,3,5,3
46,Field Day,CLUB,Common,1,3,3,2,2
47,The Fridge,CLUB,Uncommon,2,4,4,4,5
48,Detention,CLUB,Common,1,2,2,2,2
49,Good Boy Gary,CLUB,Legendary,5,7,9,7,3
50,The Morning After,CLUB,Common,1,2,2,2,3
51,Happy Holidays,CLUB,Uncommon,2,4,4,5,4
52,The Long Weekend,CLUB,Uncommon,2,4,4,2,5
53,Sofa Shark,CLUB,Rare,3,5,5,5,4
54,Never Alone,CLUB,Common,1,2,2,2,2
55,Shelf Life,CLUB,Common,1,2,2,2,2
56,A Cult Classic,CLUB,Common,1,2,2,2,2
57,Packed in Oil,CLUB,Common,1,2,2,2,2
58,Extra Salty,CLUB,Common,1,2,2,2,2
59,Fresh Cut,CLUB,Prestige,4,8,8,7,3
60,Elevator Ride,CLUB,Prestige,4,9,7,7,3
61,The Lowrider,CLUB,Prestige,4,8,8,3,7
62,The Founder,CLUB,Legendary,5,8,3,8,7
63,Serum I,MUTANT,Common,1,2,2,3,3
64,Serum II,MUTANT,Common,1,3,3,2,2
65,Serum Molt,MUTANT,Common,1,2,4,2,2
66,Serum III,MUTANT,Uncommon,2,3,6,4,3
67,The Mercury Ape,MUTANT,Rare,3,4,5,5,8
68,The Gurgle,MUTANT,Common,1,2,3,2,2
69,The Flush,MUTANT,Common,1,3,2,2,3
70,The Golden Plunger,MUTANT,Common,1,2,2,2,4
71,The Split,MUTANT,Uncommon,2,5,3,3,5
72,Skeleton Key,MUTANT,Prestige,4,3,8,8,7
73,The Spare,MUTANT,Common,1,2,2,2,2
74,The Throne,MUTANT,Common,1,2,2,2,2
75,The Lifesaver,MUTANT,Common,1,2,2,2,2
76,The DDcow,MUTANT,Rare,3,5,5,5,5
77,Half-Mutated,MUTANT,Uncommon,2,3,5,4,4
78,The Divers,MUTANT,Uncommon,2,4,4,5,3
79,The Outbreak,MUTANT,Uncommon,2,3,5,5,3
80,The Runner,MUTANT,Uncommon,2,4,4,3,5
81,Sewer Hoard,MUTANT,Prestige,4,8,8,3,7
82,Neon Cowboy,MUTANT,Prestige,4,8,3,7,8
83,The Portal,MUTANT,Legendary,5,8,3,7,8
84,The Box,MUTANT,Legendary,5,2,9,9,9
85,The Pulsar,COSMIC,Rare,3,7,6,3,6
86,The Convergence,COSMIC,Rare,3,5,5,7,5
87,The Nova,COSMIC,Rare,3,4,7,7,4
88,The Zenith,COSMIC,Rare,3,5,8,5,4
89,The Eternal,COSMIC,Rare,3,6,5,5,6
90,The Oracle,COSMIC,Legendary,5,9,8,2,9
91,The Abduction,COSMIC,Common,1,2,2,2,4
92,The Signal,COSMIC,Uncommon,2,4,4,4,5
93,I Want To Believe,COSMIC,Uncommon,2,4,4,5,3
94,The Hum,COSMIC,Common,1,3,2,2,3
95,Moon Dust,COSMIC,Common,1,4,2,2,2
96,The Watcher,COSMIC,Common,1,2,2,2,2
97,Static,COSMIC,Common,1,2,2,4,2
98,Signal Rift,COSMIC,Prestige,4,3,8,8,7
99,Hall of Mirrors,COSMIC,Prestige,4,8,3,8,7
100,Black Flag,COSMIC,Legendary,5,9,2,8,8
101,The Degen,ARCANA,Common,1,2,2,3,3
102,The Fisherman,ARCANA,Common,1,2,2,4,2
103,The Sardines,ARCANA,Common,1,2,2,3,3
104,The Full Moon,ARCANA,Common,1,3,3,2,2
105,The Fool,ARCANA,Common,1,2,2,2,2
106,The Prophet,ARCANA,Legendary,5,3,8,8,7
107,The Cult,ARCANA,Common,1,2,2,2,2
108,The Swamp,ARCANA,Common,1,2,2,2,2
109,Fossil Record,ARCANA,Common,1,3,2,2,3
110,Still Here,ARCANA,Common,1,2,2,2,2
111,Stone Mosaic,ARCANA,Uncommon,2,4,4,3,5
112,Swamp Foxfire,ARCANA,Uncommon,2,3,3,5,5
113,Heat Signature,ARCANA,Uncommon,2,4,4,4,4
114,The Tonic,ARCANA,Uncommon,2,3,5,5,3
115,The Beacon,ARCANA,Uncommon,2,5,4,4,4
116,Last Meal,ARCANA,Uncommon,2,4,5,4,4
117,The Drip,ARCANA,Common,1,2,2,3,2
118,Sun Dog,ARCANA,Prestige,4,8,3,8,7
119,Blissfully Unbothered,ARCANA,Prestige,4,8,8,3,7
120,The High Priest,ARCANA,Legendary,5,8,3,8,7`;
