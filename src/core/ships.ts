/**
 * The ship models: four ships, the dachshund and ten creatures (animals,
 * fantasy beasts, comic figures and aliens). Each flies a little differently and has one special
 * ability with a cooldown (key C). All numbers are factors on the base flight
 * model, so the simulation stays the same on every device.
 */

export type ShipId =
  | 'trident'
  | 'manta'
  | 'halo'
  | 'bulwark'
  | 'dachshund'
  | 'dragon'
  | 'unicorn'
  | 'phoenix'
  | 'shark'
  | 'owl'
  | 'bee'
  | 'duck'
  | 'pig'
  | 'octopus'
  | 'jelly';
export type SpecialKind = 'burst' | 'afterburner' | 'phase' | 'shockwave';

export interface ShipSpec {
  readonly id: ShipId;
  readonly name: string;
  readonly model: string;
  readonly role: string;
  /** Hits the ship takes before it goes down. */
  readonly hull: number;
  /** Yaw and pitch rate factor. */
  readonly turn: number;
  readonly roll: number;
  /** Cruise and boost speed factors. */
  readonly cruise: number;
  readonly boost: number;
  /** Slipstream recharge factor. */
  readonly slip: number;
  /** Shot speed factor. */
  readonly shotSpeed: number;
  /** Heat per shot factor. */
  readonly heat: number;
  readonly trait: string;
  readonly special: {
    readonly kind: SpecialKind;
    readonly name: string;
    readonly text: string;
    /** Ticks until it can be used again. */
    readonly cooldown: number;
    /** Ticks the effect lasts (0 = instant). */
    readonly duration: number;
  };
  /** 0..1 ratings for the hangar. */
  readonly stats: { speed: number; agility: number; armor: number; firepower: number };
}

export const SHIPS: Readonly<Record<ShipId, ShipSpec>> = {
  trident: {
    id: 'trident',
    name: 'Trident',
    model: 'TR-1',
    role: 'Gunship',
    hull: 3,
    turn: 1,
    roll: 1,
    cruise: 1,
    boost: 1,
    slip: 1,
    shotSpeed: 1.2,
    heat: 0.85,
    trait: 'Shots fly 20% faster and the gun heats up more slowly.',
    special: {
      kind: 'burst',
      name: 'Trident Burst',
      text: 'Fires a fan of five shots at once, without heating the gun.',
      cooldown: 8 * 60,
      duration: 0,
    },
    stats: { speed: 0.6, agility: 0.6, armor: 0.5, firepower: 1 },
  },
  manta: {
    id: 'manta',
    name: 'Manta',
    model: 'MR-2',
    role: 'Interceptor',
    hull: 3,
    turn: 1.15,
    roll: 1.1,
    cruise: 1.04,
    boost: 1.05,
    slip: 1.5,
    shotSpeed: 1,
    heat: 1,
    trait: 'Sharpest turns. Flying along walls charges the boost 50% faster.',
    special: {
      kind: 'afterburner',
      name: 'Afterburner',
      text: 'Two seconds at top speed with even sharper turns. Uses no boost.',
      cooldown: 9 * 60,
      duration: 2 * 60,
    },
    stats: { speed: 0.9, agility: 1, armor: 0.5, firepower: 0.5 },
  },
  halo: {
    id: 'halo',
    name: 'Halo',
    model: 'HX-3',
    role: 'Phase runner',
    hull: 3,
    turn: 1.05,
    roll: 1.4,
    cruise: 1,
    boost: 1,
    slip: 1.15,
    shotSpeed: 1,
    heat: 1,
    trait: 'Rolls 40% faster and charges its boost a little faster along walls.',
    special: {
      kind: 'phase',
      name: 'Phase Shift',
      text: 'For 1.5 seconds you fly straight through walls and obstacles, and shots pass through you.',
      cooldown: 14 * 60,
      duration: 90,
    },
    stats: { speed: 0.65, agility: 0.8, armor: 0.5, firepower: 0.55 },
  },
  bulwark: {
    id: 'bulwark',
    name: 'Bulwark',
    model: 'BW-4',
    role: 'Heavy',
    hull: 5,
    turn: 0.88,
    roll: 0.9,
    cruise: 0.96,
    boost: 0.96,
    slip: 1,
    shotSpeed: 1,
    heat: 1,
    trait: 'Takes five hits instead of three. Turns a little slower.',
    special: {
      kind: 'shockwave',
      name: 'Shockwave',
      text: 'Wipes out enemy shots within 55 m and jams their guns for three seconds.',
      cooldown: 12 * 60,
      duration: 0,
    },
    stats: { speed: 0.5, agility: 0.4, armor: 1, firepower: 0.7 },
  },
  dachshund: {
    id: 'dachshund',
    name: 'Dachshund',
    model: 'WAU-5',
    role: 'Good boy',
    hull: 3,
    turn: 1.2,
    roll: 1.15,
    cruise: 0.98,
    boost: 1.02,
    slip: 1.2,
    shotSpeed: 1.1,
    heat: 0.9,
    trait: 'Turns tighter than any ship and spits bones instead of shots. Gallops through the air with its ears flapping.',
    special: {
      kind: 'burst',
      name: 'Bone Barrage',
      text: 'Spits a fan of five bones at once.',
      cooldown: 9 * 60,
      duration: 0,
    },
    stats: { speed: 0.6, agility: 1, armor: 0.5, firepower: 0.65 },
  },
  dragon: {
    id: 'dragon',
    name: 'Dragon',
    model: 'DRG-6',
    role: 'Fire beast',
    hull: 4,
    turn: 0.95,
    roll: 0.95,
    cruise: 1,
    boost: 1.05,
    slip: 1,
    shotSpeed: 1.1,
    heat: 0.9,
    trait: 'Scales take four hits. Big wings, a long tail and a glowing throat.',
    special: {
      kind: 'shockwave',
      name: 'Dragon Roar',
      text: 'A roar that wipes out enemy shots within 55 m and jams their guns.',
      cooldown: 12 * 60,
      duration: 0,
    },
    stats: { speed: 0.65, agility: 0.5, armor: 0.8, firepower: 0.8 },
  },
  unicorn: {
    id: 'unicorn',
    name: 'Unicorn',
    model: 'UNI-7',
    role: 'Dream runner',
    hull: 3,
    turn: 1.1,
    roll: 1.2,
    cruise: 1.03,
    boost: 1.05,
    slip: 1.2,
    shotSpeed: 1,
    heat: 1,
    trait: 'Gallops on rainbow wings and rolls easily.',
    special: {
      kind: 'phase',
      name: 'Rainbow Dash',
      text: 'For 1.5 seconds you gallop straight through walls and obstacles.',
      cooldown: 14 * 60,
      duration: 90,
    },
    stats: { speed: 0.75, agility: 0.8, armor: 0.5, firepower: 0.5 },
  },
  phoenix: {
    id: 'phoenix',
    name: 'Phoenix',
    model: 'PHX-8',
    role: 'Fire bird',
    hull: 3,
    turn: 1.05,
    roll: 1.05,
    cruise: 1.05,
    boost: 1.08,
    slip: 1.1,
    shotSpeed: 1,
    heat: 1,
    trait: 'The fastest of the creatures, with glowing tail plumes.',
    special: {
      kind: 'afterburner',
      name: 'Firestorm',
      text: 'Two seconds of blazing top speed.',
      cooldown: 9 * 60,
      duration: 120,
    },
    stats: { speed: 0.9, agility: 0.65, armor: 0.5, firepower: 0.55 },
  },
  shark: {
    id: 'shark',
    name: 'Rocket Shark',
    model: 'SHK-9',
    role: 'Hunter',
    hull: 4,
    turn: 0.95,
    roll: 0.95,
    cruise: 1.06,
    boost: 1.06,
    slip: 1,
    shotSpeed: 1.15,
    heat: 1,
    trait: 'A rocket on its back: fast, tough and its shots fly far.',
    special: {
      kind: 'burst',
      name: 'Feeding Frenzy',
      text: 'Fires a fan of five shots at once.',
      cooldown: 8 * 60,
      duration: 0,
    },
    stats: { speed: 0.85, agility: 0.45, armor: 0.7, firepower: 0.85 },
  },
  owl: {
    id: 'owl',
    name: 'Night Owl',
    model: 'OWL-10',
    role: 'Silent hunter',
    hull: 3,
    turn: 1.15,
    roll: 1.1,
    cruise: 1,
    boost: 1,
    slip: 1.3,
    shotSpeed: 1,
    heat: 1,
    trait: 'Turns sharply and charges its boost fast along walls.',
    special: {
      kind: 'phase',
      name: 'Silent Wings',
      text: 'For 1.5 seconds you glide through walls and obstacles.',
      cooldown: 14 * 60,
      duration: 90,
    },
    stats: { speed: 0.55, agility: 0.9, armor: 0.5, firepower: 0.55 },
  },
  bee: {
    id: 'bee',
    name: 'Bumblebee',
    model: 'BZZ-11',
    role: 'Buzzer',
    hull: 3,
    turn: 1.25,
    roll: 1.3,
    cruise: 0.95,
    boost: 1,
    slip: 1.1,
    shotSpeed: 1,
    heat: 0.8,
    trait: 'The nimblest flyer of all; its gun heats up slowly.',
    special: {
      kind: 'burst',
      name: 'Sting Swarm',
      text: 'Fires a fan of five stings at once.',
      cooldown: 8 * 60,
      duration: 0,
    },
    stats: { speed: 0.5, agility: 1, armor: 0.45, firepower: 0.75 },
  },
  duck: {
    id: 'duck',
    name: 'Rubber Duck',
    model: 'QCK-12',
    role: 'Bath captain',
    hull: 5,
    turn: 0.9,
    roll: 0.9,
    cruise: 0.97,
    boost: 0.97,
    slip: 1,
    shotSpeed: 1,
    heat: 1,
    trait: 'Takes five hits. Goggles on, scarf flying.',
    special: {
      kind: 'shockwave',
      name: 'Mega Quack',
      text: 'A quack that wipes out enemy shots within 55 m and jams their guns.',
      cooldown: 12 * 60,
      duration: 0,
    },
    stats: { speed: 0.5, agility: 0.45, armor: 1, firepower: 0.6 },
  },
  pig: {
    id: 'pig',
    name: 'Flying Pig',
    model: 'OINK-13',
    role: 'Miracle',
    hull: 4,
    turn: 1,
    roll: 1,
    cruise: 0.98,
    boost: 1.04,
    slip: 1,
    shotSpeed: 1,
    heat: 1,
    trait: 'When pigs fly: tough, with tiny flapping wings.',
    special: {
      kind: 'afterburner',
      name: 'Hog Rocket',
      text: 'Two seconds at top speed.',
      cooldown: 9 * 60,
      duration: 120,
    },
    stats: { speed: 0.7, agility: 0.55, armor: 0.8, firepower: 0.5 },
  },
  octopus: {
    id: 'octopus',
    name: 'Octo Alien',
    model: 'OCT-14',
    role: 'Visitor',
    hull: 3,
    turn: 1.1,
    roll: 1.05,
    cruise: 1,
    boost: 1,
    slip: 1,
    shotSpeed: 1.05,
    heat: 0.75,
    trait: 'Eight arms, three eyes; its gun hardly heats up.',
    special: {
      kind: 'burst',
      name: 'Ink Barrage',
      text: 'Fires a fan of five shots at once.',
      cooldown: 8 * 60,
      duration: 0,
    },
    stats: { speed: 0.6, agility: 0.75, armor: 0.5, firepower: 0.9 },
  },
  jelly: {
    id: 'jelly',
    name: 'Space Jelly',
    model: 'JLY-15',
    role: 'Drifter',
    hull: 3,
    turn: 1.05,
    roll: 1.1,
    cruise: 1,
    boost: 1,
    slip: 1.4,
    shotSpeed: 1,
    heat: 1,
    trait: 'Glows in the dark and charges its boost fastest along walls.',
    special: {
      kind: 'phase',
      name: 'Ghost Drift',
      text: 'For almost two seconds you drift through walls and obstacles.',
      cooldown: 14 * 60,
      duration: 110,
    },
    stats: { speed: 0.6, agility: 0.7, armor: 0.45, firepower: 0.5 },
  },
};

export const SHIP_ORDER: readonly ShipId[] = ['trident', 'manta', 'halo', 'bulwark', 'dachshund', 'dragon', 'unicorn', 'phoenix', 'shark', 'owl', 'bee', 'duck', 'pig', 'octopus', 'jelly'];

/** The four real ships: they fly in the intro and behind the menus, and bots fly them. The dachshund is only picked in the hangar. */
export const FLEET: readonly ShipId[] = ['trident', 'manta', 'halo', 'bulwark'];

export const isShip = (v: unknown): v is ShipId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(SHIPS, v);

/** Ship of bot i in a round: the same on every device for the same seed. */
export function botShip(seed: number, i: number): ShipId {
  return FLEET[((seed >>> 3) + i * 3) % FLEET.length];
}

/** Radius of the Bulwark's shockwave. */
export const SHOCKWAVE_RADIUS = 55;
/** Ticks an enemy gun stays jammed after a shockwave. */
export const JAM_TICKS = 3 * 60;
