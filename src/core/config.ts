/**
 * Version of the simulation rules. Online scores are verified by replaying the
 * flight on the server, so client and server must run the same rules. Bump this
 * whenever a change alters how a flight plays out.
 */
export const CORE_VERSION = 'core-3';

/** Version of the online message format. Devices with different versions cannot play together. */
export const NET_PROTOCOL = 'p2';
/** Pilots per online game, bots included. */
export const MAX_ONLINE_PILOTS = 8;

/** Fixed simulation rate. Every device steps the world exactly this often. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const COUNTDOWN_TICKS = 3 * TICK_RATE;

/** A wall sample is stored every few ticks (20 per second). */
export const SAMPLE_TICKS = 3;
/** Half height of a light wall. The wall spans +-WALL_HALF along the glider's up axis. */
export const WALL_HALF = 2.0;
/** The wall leaves the glider this far behind its centre. */
export const TAIL_OFFSET = 1.8;
/** Wing probes: collisions are tested at the centre and at both half wings. */
export const WING_PROBE = 1.25;
/** Own newest wall segments that can never hit you (sharp turns stay fair). */
export const SELF_SKIP = 8;
/** Own newest wall segments ignored for slipstream boost. */
export const SELF_SLIP_SKIP = 40;
/** Two gliders closer than this collide. */
export const GLIDER_HIT_RADIUS = 1.6;
/** Spatial hash cell size for wall lookups. */
export const HASH_CELL = 8;
/** Radius around a glider in which walls are checked every tick. */
export const QUERY_RADIUS = 7.5;
/** Lightning bolts kill within this distance. */
export const BOLT_RADIUS = 1.4;

export const FLIGHT = {
  cruiseSpeed: 24,
  boostSpeed: 38,
  speedLerp: 0.05,
  yawRate: 1.45,
  pitchRate: 1.35,
  rollRate: 3.3,
  bankMax: 0.95,
  bankLerp: 0.12,
  autoHorizonRate: 1.1,
  autoHorizonGain: 2.2,
  boostDrain: 0.006,
  boostRegen: 0.0016,
  slipRegen: 0.0045,
  slipRange: 7,
  ringBoost: 0.45,
} as const;

/**
 * The gun. Shots fly through walls and only hit other gliders. They curve a
 * little towards a glider in front of them. Every shot heats the gun; at full
 * heat it locks until it has cooled down.
 */
export const GUN = {
  /** Shot speed in m/s. */
  speed: 85,
  /** Ticks a shot lives (about 125 m). */
  life: 88,
  /** Ticks between two shots while the trigger is held. */
  interval: 12,
  heatPerShot: 0.22,
  /** Heat lost per second. */
  cool: 0.36,
  /** An overheated gun works again below this heat. */
  unlock: 0.3,
  /** How strongly a shot turns towards its target each tick. */
  homing: 0.035,
  /** Targets within this cone (cos of the half angle) and range pull the shot. */
  homingCone: 0.87,
  homingRange: 110,
  /** A shot hits when it passes this close to a glider's centre. */
  hitRadius: 2.3,
  /** Hits a glider takes before it goes down. */
  hull: 3,
  /** Boost energy a hit knocks out. */
  energyHit: 0.2,
  /** The shot leaves the glider this far in front of its centre. */
  muzzle: 3,
} as const;

/** Shot keys: owner * SHOT_KEY + running number of that owner's shots. */
export const SHOT_KEY = 65536;
