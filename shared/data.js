// Classic UK London board data. Shared by server (rules) and client (rendering).

export const GROUPS = {
  brown:     { color: '#955436', name: 'Brown',      houseCost: 50 },
  lightblue: { color: '#AAE0FA', name: 'Light Blue', houseCost: 50 },
  pink:      { color: '#D93A96', name: 'Pink',       houseCost: 100 },
  orange:    { color: '#F7941D', name: 'Orange',     houseCost: 100 },
  red:       { color: '#ED1B24', name: 'Red',        houseCost: 150 },
  yellow:    { color: '#FEF200', name: 'Yellow',     houseCost: 150 },
  green:     { color: '#1FB25A', name: 'Green',      houseCost: 200 },
  darkblue:  { color: '#0072BB', name: 'Dark Blue',  houseCost: 200 },
};

// Classic UK / London edition (Park Lane, Mayfair). Rent tables match the
// official board position-for-position.
export const CURRENCY = '£';

// rent: [base, 1 house, 2, 3, 4, hotel]
export const TILES = [
  { id: 0,  type: 'go',        name: 'GO' },
  { id: 1,  type: 'property',  name: 'Old Kent Road',        group: 'brown',     price: 60,  rent: [2, 10, 30, 90, 160, 250] },
  { id: 2,  type: 'chest',     name: 'Community Chest' },
  { id: 3,  type: 'property',  name: 'Whitechapel Road',     group: 'brown',     price: 60,  rent: [4, 20, 60, 180, 320, 450] },
  { id: 4,  type: 'tax',       name: 'Income Tax', amount: 200 },
  { id: 5,  type: 'railroad',  name: "King's Cross Station", price: 200 },
  { id: 6,  type: 'property',  name: 'The Angel Islington',  group: 'lightblue', price: 100, rent: [6, 30, 90, 270, 400, 550] },
  { id: 7,  type: 'chance',    name: 'Chance' },
  { id: 8,  type: 'property',  name: 'Euston Road',          group: 'lightblue', price: 100, rent: [6, 30, 90, 270, 400, 550] },
  { id: 9,  type: 'property',  name: 'Pentonville Road',     group: 'lightblue', price: 120, rent: [8, 40, 100, 300, 450, 600] },
  { id: 10, type: 'jail',      name: 'Jail / Just Visiting' },
  { id: 11, type: 'property',  name: 'Pall Mall',            group: 'pink',      price: 140, rent: [10, 50, 150, 450, 625, 750] },
  { id: 12, type: 'utility',   name: 'Electric Company',     price: 150 },
  { id: 13, type: 'property',  name: 'Whitehall',            group: 'pink',      price: 140, rent: [10, 50, 150, 450, 625, 750] },
  { id: 14, type: 'property',  name: 'Northumberland Avenue', group: 'pink',     price: 160, rent: [12, 60, 180, 500, 700, 900] },
  { id: 15, type: 'railroad',  name: 'Marylebone Station',   price: 200 },
  { id: 16, type: 'property',  name: 'Bow Street',           group: 'orange',    price: 180, rent: [14, 70, 200, 550, 750, 950] },
  { id: 17, type: 'chest',     name: 'Community Chest' },
  { id: 18, type: 'property',  name: 'Marlborough Street',   group: 'orange',    price: 180, rent: [14, 70, 200, 550, 750, 950] },
  { id: 19, type: 'property',  name: 'Vine Street',          group: 'orange',    price: 200, rent: [16, 80, 220, 600, 800, 1000] },
  { id: 20, type: 'parking',   name: 'Free Parking' },
  { id: 21, type: 'property',  name: 'Strand',               group: 'red',       price: 220, rent: [18, 90, 250, 700, 875, 1050] },
  { id: 22, type: 'chance',    name: 'Chance' },
  { id: 23, type: 'property',  name: 'Fleet Street',         group: 'red',       price: 220, rent: [18, 90, 250, 700, 875, 1050] },
  { id: 24, type: 'property',  name: 'Trafalgar Square',     group: 'red',       price: 240, rent: [20, 100, 300, 750, 925, 1100] },
  { id: 25, type: 'railroad',  name: 'Fenchurch St. Station', price: 200 },
  { id: 26, type: 'property',  name: 'Leicester Square',     group: 'yellow',    price: 260, rent: [22, 110, 330, 800, 975, 1150] },
  { id: 27, type: 'property',  name: 'Coventry Street',      group: 'yellow',    price: 260, rent: [22, 110, 330, 800, 975, 1150] },
  { id: 28, type: 'utility',   name: 'Water Works',          price: 150 },
  { id: 29, type: 'property',  name: 'Piccadilly',           group: 'yellow',    price: 280, rent: [24, 120, 360, 850, 1025, 1200] },
  { id: 30, type: 'gotojail',  name: 'Go To Jail' },
  { id: 31, type: 'property',  name: 'Regent Street',        group: 'green',     price: 300, rent: [26, 130, 390, 900, 1100, 1275] },
  { id: 32, type: 'property',  name: 'Oxford Street',        group: 'green',     price: 300, rent: [26, 130, 390, 900, 1100, 1275] },
  { id: 33, type: 'chest',     name: 'Community Chest' },
  { id: 34, type: 'property',  name: 'Bond Street',          group: 'green',     price: 320, rent: [28, 150, 450, 1000, 1200, 1400] },
  { id: 35, type: 'railroad',  name: 'Liverpool Street Station', price: 200 },
  { id: 36, type: 'chance',    name: 'Chance' },
  { id: 37, type: 'property',  name: 'Park Lane',            group: 'darkblue',  price: 350, rent: [35, 175, 500, 1100, 1300, 1500] },
  { id: 38, type: 'tax',       name: 'Super Tax', amount: 100 },
  { id: 39, type: 'property',  name: 'Mayfair',              group: 'darkblue',  price: 400, rent: [50, 200, 600, 1400, 1700, 2000] },
];

export const RAILROAD_RENT = [25, 50, 100, 200]; // by number of railroads owned
export const UTILITY_MULT = [4, 10];             // by number of utilities owned
export const GO_SALARY = 200;
export const JAIL_FINE = 50;
export const START_MONEY = 1500;
export const JAIL_POS = 10;

export const CHANCE_CARDS = [
  { text: 'Advance to GO. Collect £200.', action: 'move', to: 0 },
  { text: 'Advance to Trafalgar Square. If you pass GO, collect £200.', action: 'move', to: 24 },
  { text: 'Advance to Pall Mall. If you pass GO, collect £200.', action: 'move', to: 11 },
  { text: 'Advance to the nearest Utility. If unowned, you may buy it. If owned, pay the owner 10 times your dice roll.', action: 'nearest-utility' },
  { text: 'Advance to the nearest Railroad. If owned, pay the owner twice the rent. If unowned, you may buy it.', action: 'nearest-railroad' },
  { text: 'Advance to the nearest Railroad. If owned, pay the owner twice the rent. If unowned, you may buy it.', action: 'nearest-railroad' },
  { text: 'Bank pays you a dividend of £50.', action: 'collect', amount: 50 },
  { text: 'Get Out of Jail Free. This card may be kept until needed or traded.', action: 'jail-card' },
  { text: 'Go back 3 spaces.', action: 'back3' },
  { text: 'Go directly to Jail. Do not pass GO. Do not collect £200.', action: 'gotojail' },
  { text: 'Make general repairs on all your property: pay £25 for each house and £100 for each hotel.', action: 'repairs', house: 25, hotel: 100 },
  { text: 'Pay poor tax of £15.', action: 'pay', amount: 15 },
  { text: "Take a trip to King's Cross Station. If you pass GO, collect £200.", action: 'move', to: 5 },
  { text: 'Advance to Mayfair.', action: 'move', to: 39 },
  { text: 'You have been elected Chairman of the Board. Pay each player £50.', action: 'pay-each', amount: 50 },
  { text: 'Your building loan matures. Collect £150.', action: 'collect', amount: 150 },
];

export const CHEST_CARDS = [
  { text: 'Advance to GO. Collect £200.', action: 'move', to: 0 },
  { text: 'Bank error in your favor. Collect £200.', action: 'collect', amount: 200 },
  { text: "Doctor's fees. Pay £50.", action: 'pay', amount: 50 },
  { text: 'From sale of stock you get £50.', action: 'collect', amount: 50 },
  { text: 'Get Out of Jail Free. This card may be kept until needed or traded.', action: 'jail-card' },
  { text: 'Go directly to Jail. Do not pass GO. Do not collect £200.', action: 'gotojail' },
  { text: 'Holiday fund matures. Collect £100.', action: 'collect', amount: 100 },
  { text: 'Income tax refund. Collect £20.', action: 'collect', amount: 20 },
  { text: 'It is your birthday. Collect £10 from every player.', action: 'collect-each', amount: 10 },
  { text: 'Life insurance matures. Collect £100.', action: 'collect', amount: 100 },
  { text: 'Pay hospital fees of £100.', action: 'pay', amount: 100 },
  { text: 'Pay school fees of £50.', action: 'pay', amount: 50 },
  { text: 'Receive £25 consultancy fee.', action: 'collect', amount: 25 },
  { text: 'You are assessed for street repairs: pay £40 per house and £115 per hotel.', action: 'repairs', house: 40, hotel: 115 },
  { text: 'You have won second prize in a beauty contest. Collect £10.', action: 'collect', amount: 10 },
  { text: 'You inherit £100.', action: 'collect', amount: 100 },
];

export const TOKENS = [
  { id: 'top-hat',     name: 'Top Hat',     img: '/assets/tokens/top-hat.svg' },
  { id: 'race-car',    name: 'Race Car',    img: '/assets/tokens/race-car.svg' },
  { id: 'dog',         name: 'Dog',         img: '/assets/tokens/dog.svg' },
  { id: 'battleship',  name: 'Battleship',  img: '/assets/tokens/battleship.svg' },
  { id: 'boot',        name: 'Boot',        img: '/assets/tokens/boot.svg' },
  { id: 'cat',         name: 'Cat',         img: '/assets/tokens/cat.svg' },
  { id: 'thimble',     name: 'Thimble',     img: '/assets/tokens/thimble.svg' },
  { id: 'wheelbarrow', name: 'Wheelbarrow', img: '/assets/tokens/wheelbarrow.svg' },
];

export const PLAYER_COLORS = ['#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#00ACC1', '#F06292', '#6D4C41'];

export function groupTiles(group) {
  return TILES.filter(t => t.group === group).map(t => t.id);
}
