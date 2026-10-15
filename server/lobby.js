import { roomExtensions } from '../shared/roomExtensions.js';
import { FriendRooms } from './friendRooms.js';
// server/lobby.js — rooms, seats, host, AI seats, ready/start, reconnect, and room → Match wiring
// (DESIGN §2, §6.1 LOBBY, §8.1). Implements the handler interface consumed by server/net.js.
//
// Rules (the choices where DESIGN is silent are marked ▸):
//   * Rooms are keyed by 4-letter codes from an unambiguous alphabet (no I/O, letters only). Join codes are
//     case-insensitive.
//   * 'solo' rooms hold exactly one human and never bots. 'coop' rooms have 4 seats (humans + AI bots).
//     Humans and bots take the lowest free seat index; seat indexes never compact.
//   * ▸ Being in a LOBBY room and sending room.create / room.join implicitly leaves it. While your room is
//     in a match, create/join of another room fails with ROOM_STARTED (send g.leave or room.leave first).
//   * Host-only: room.setDifficulty, room.addBot, room.removeBot, room.kick, room.start. ▸ Changing the difficulty
//     un-readies the other humans. ▸ room.start requires every other human to be connected and ready;
//     the host's start counts as the host's ready (the host may still toggle room.ready for display).
//   * room.kick {seat, playerId} (community report #17, owner approved): before the match only, the host removes another
//     human like an AI seat (an AI seat stays room.removeBot's; never the host itself). `playerId` names the player the
//     host confirmed: a seat that changed hands meanwhile (left, someone else joined) is refused with BAD_TARGET. The
//     seat is freed at once and the player gets `room.closed {reason:'kicked'}` — now, or on the next resume when
//     offline (with the result replay, as the grace timeout) —, so the reconnect token no longer leads back to the seat
//     (it stays the player's identity: net.js sessions belong to players, not seats). ▸ No ban: the player may join
//     again with the code.
//   * Host migration: when the host leaves (or is removed), the lowest-seat remaining human (connected
//     ones first) becomes host. A room without humans is disposed (bots never keep a room alive).
//   * Disconnect in LOBBY: the seat shows connected=false and is freed after `lobbyGraceMs` (60 s); a
//     session that comes back after that gets `room.closed {reason:'timeout'}`.
//     Disconnect in a match: the seat is kept and match.onDisconnect(playerId) is called.
//   * Reconnect: `hello` with a known token (reconnect window, 10 min, see net.js) rebinds the session;
//     the lobby then broadcasts room.state and, in a match, calls match.onReconnect(playerId).
//     Solo runs (下半: "休整期及机变阶段没有时间限制…24小时内随时返回", research 01 §1 / 06 §17): a session that drops
//     while its solo room's match runs stays resumable for the official `config.constants.singleReconnectTime`
//     (86400 s; option `soloReconnectWindowMs` overrides it) instead of the 10-minute window — the untimed solo match
//     simply waits (net.js session.resumeWindowMs, set at every disconnect). Only after that does expiry turn into
//     match.onLeave ('abandoned'). The extension outlives the match, so a run that ended meanwhile (e.g. a server-run
//     Final Assault) still shows its result on the player's return.
//     A repeated hello on a live connection is a full resync: room.state goes to the requester only
//     (broadcast only when the seat visibly changed, e.g. a rename in LOBBY); the heavy part (match.onReconnect,
//     or the result replay below) runs at most once per `resyncMinGapMs` per session — extra requests inside
//     that window coalesce into one deferred resync, so hello spam cannot amplify into ~15 KB per request.
//   * Result replay: the match's final m.public and each human's m.result are kept after the match ends. A
//     human who resyncs (resume after a drop, a reloaded tab, a repeated hello) while the room is back in LOBBY
//     gets room.state followed by those two frames again, until they act in the room (ready, difficulty, AI
//     seats, start), leave it, or a new match starts. A human removed by the lobby grace gets them right after
//     `room.closed {timeout}` on their next resume (Match.onReconnect cannot do this: the lobby drops the
//     match reference at onEnd and disposes it on the next macrotask).
//   * Per-network limits (internet clients only, see net.js clientAddress): at most `maxRoomsPerAddr` rooms
//     created from one network may exist at once and at most `maxMatchesPerAddr` matches started from one
//     network may run at once (room.create / room.start → ERR.RATE). Without them a socket loop could fill
//     `maxRooms` or keep hundreds of unattended matches simulating for the whole reconnect window.
//   * Permanent departure during a match (room.leave, g.leave, reconnect window expired): the seat is
//     marked departed (shown as connected=false), match.onLeave(playerId) is called, and the seat is freed
//     when the match ends. 'g.leave' is handled here and never reaches match.handle().
//   * All other 'g.*' messages go to room.match.handle(playerId, msg); its {ok}/{error} becomes the reply.
//   * Match lifecycle: room.start → new Match({...}) → room.state (inMatch=true) → match.start(). The match gets
//     `matchNo` = the room's match number (1, 2, …): with the seed it keeps battleIds unique across the room's
//     matches, so a late b.progress / b.result of the previous match is ignored by the next one (DESIGN §14).
//     onEnd(summary) → room back to LOBBY (departed seats freed, humans un-readied, disconnected humans
//     get the lobby grace), dispose() on the next macrotask. Players can start again.
//   * room.closed reasons: 'timeout' (removed after lobby grace), 'kicked' (room.kick, room.removeSpectator), 'empty' (a
//     spectator whose room lost its last player), 'shutdown' (server stopping).
//   * Operator loadout (DESIGN §16): room.loadout { entries } is checked strictly against the game data
//     (shared/protocol.js checkLoadout: known visible chess, a skill index legal for the normal AND the elite status, a
//     module of the elite or 'none'; any bad entry rejects the whole message, nothing is stored). ▸ It is stored on the
//     session (it follows the player into every room they create/join, and survives a resume) and on the seat; the
//     match receives seats[].loadout (bots: none — they fight with the defaults). ▸ Accepted any time: in a LOBBY room
//     (or outside a room) it simply replaces the stored one; while the room's match runs it is also handed to
//     match.setLoadout(playerId, loadout), which accepts it only during INFO_CHECK (the 干员调配 entry of the briefing)
//     and refuses it afterwards (WRONG_PHASE: the match's loadout is locked, the stored one applies to the next match).
//   * Operator ownership (干员持有, 0.2.0 补位, owner's decision 2026-10-05): room.ownership { notOwned } — the base chess
//     ids the player marked as not owned — is checked leniently (shared/protocol.js checkNotOwned: anything that is not
//     a droppable NORMAL chess is dropped, never the whole list; only a malformed list is BAD_MSG) and stored on the
//     session and the seat like the loadout. The match receives seats[].notOwned when it starts (bots: none — they own
//     every operator) and keeps it for its whole length: the setting is out of match ("局外设置，下一局生效"), so while
//     the room's match runs a new list is only stored for the next match (ROOM_STARTED 'stored for the next match',
//     never handed to the match). A spectator's list stays on its session.
//   * 自选编队 (0.2.0 DIY, the owner's decisions of 2026-10-05): room.diy { picks } — the player's picks for the four DIY
//     slots ({ [slotBaseId]: { charId, skillIndex?, uniEquipId? } | null }) — is checked leniently (shared/protocol.js
//     checkDiyPicks against the game data and the kit registry, server/sim/content/kits/index.js KITTED_CHARS: an
//     illegal pick — an operator without a kit, another tier's prototype, a prototype off its locked skill, a second slot
//     of one owned operator, the same operator twice in a tier, an unknown slot / skill / module — is dropped, never the
//     whole roster; only malformed picks are BAD_MSG) and stored on the session and the seat exactly like the
//     not-owned list: the match receives seats[].diy when it starts (bots: none — they field no 自选 piece [ASSUMED]),
//     and a change while it runs is stored for the next match (ROOM_STARTED 'stored for the next match'). Every
//     `welcome` carries `diyKitted` (welcomeInfo): the operators a DIY slot may field, so the client's picker offers
//     exactly what the server accepts.
//   * Spectator seats (community report #26, owner's decision 2026-10-04 — a remake feature, the official room has none):
//     room.spectate { code } takes one of a co-op room's MAX_SPECTATORS (2) spectator seats, in its lobby or while its
//     match runs (▸ solo rooms: ROOM_FULL). A spectator is not a player: never in `seats`, never counted for the 1–4 players
//     or the start gate, never host, never keeps a room alive (a room whose last human leaves closes with room.closed
//     {empty} for its spectators). It receives room.state (`spectators: [{ playerId, name, connected }]`) and every match
//     broadcast (m.public, m.ticker, m.emote, b.pool — public data); the match registers it (opts.spectators /
//     addSpectator) and shows it fields like an eliminated player (b.start watch / m.field), never an m.private. It may
//     only g.watch (the heavy bucket, like every watcher), g.leave / room.leave, and room.loadout / room.ownership /
//     room.diy (stored for its session, never handed to the match); anything else → SPECTATOR (▸ emotes too). Host: room.removeSpectator { playerId } any
//     time → room.closed {kicked} to it. A spectator in a LOBBY room may take a free player seat with room.join of the same
//     code; a player never switches to spectating in place (ALREADY). Disconnect / grace / reconnect / expiry work as for
//     a player seat (the seat is kept and given back on resume).

import { PREVIEW_BATTLE_CAPACITY, MULTIPLAYER_PENDING } from '../shared/integrationStage.js';
import { randomBytes, randomInt } from 'node:crypto';
import { validGameMode } from '../shared/cloneMode.js';
import { VersusMatch } from './versus/match.js';
import { ERR, DEFAULT_SEATS, MAX_SEATS, MAX_SPECTATORS, ROOM_CAPACITIES, ROOM_CODE_LEN, modeIdFor, roomCapacity } from '../shared/constants.js';
import { checkLoadout, checkNotOwned, checkDiyPicks } from '../shared/protocol.js';
import { CHAT_HISTORY_LIMIT, CHAT_INTERVAL_MS, sanitizeChat, validChat } from '../shared/chat.js';
import { RECRUIT_INTERVAL_MS, validRecruitment, validVisibility, validMapVersion } from '../shared/roomDirectory.js';
import { encode, isDroppable, isErrCode, sendEncoded, sendRaw, sendSession } from './net.js';
import { getData as defaultGetData, lookup } from './data.js';
import { Match as DefaultMatch } from './match/Match.js';
import { KITTED_CHARS } from './sim/content/kits/index.js';

/** Room code alphabet: uppercase letters without I and O (and no digits, so no 0/1). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Tunables. */
export const LOBBY_DEFAULTS = Object.freeze({
  lobbyGraceMs: 60_000,   // disconnected humans keep their lobby seat this long
  maxRooms: 1000,
  maxRoomsPerAddr: 16,    // rooms created from one client network that may exist at once (0 = unlimited)
  maxMatchesPerAddr: 8,   // matches started from one client network that may run at once (0 = unlimited)
  resyncMinGapMs: 1000,   // heavy resyncs (match state / result replay) per session at most this often on repeated hellos
  soloReconnectWindowMs: null, // a dropped solo run stays resumable this long (null = data singleReconnectTime, 24 h)
});

/** Official `singleReconnectTime` (s) when the data lacks it (constData, research 01 §1). */
export const SOLO_RECONNECT_FALLBACK_SEC = 86_400;

/** Display names for AI teammates (the tutorial NPCs first, then a few familiar faces). */
export const BOT_NAMES = Object.freeze(['AI·华法琳', 'AI·阿米娅', 'AI·惊蛰', 'AI·杜宾', 'AI·凯尔希', 'AI·可露希尔']); // i18n-ignore: player names (docs/I18N.md)

const OK = Object.freeze({ ok: true });
const fail = (code, detail) => (detail ? { error: code, detail } : { error: code });
const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * @typedef {{ seat: number, playerId: string, name: string, isBot: boolean, ready: boolean,
 *             connected: boolean, left: boolean, loadout?: Record<string, { skill: number, module: string|null }> | null,
 *             notOwned?: readonly string[] | null, diy?: Readonly<Record<string, DiyLoadout>> | null }} Seat
 * @typedef {{ charId: string, skillIndex: number, uniEquipId: string|null }} DiyLoadout
 */

/** Deep-frozen copy of a checked loadout (shared by the session, the seat and the match's PlayerState). */
function freezeLoadout(loadout) {
  const out = {};
  for (const [id, e] of Object.entries(loadout || {})) out[id] = Object.freeze({ skill: e.skill, module: e.module ?? null });
  return Object.freeze(out);
}

/** Deep-frozen copy of checked 自选 picks (shared by the session, the seat and the match's PlayerState). */
function freezeDiy(picks) {
  const out = {};
  for (const [id, p] of Object.entries(picks || {})) out[id] = Object.freeze({ charId: p.charId, skillIndex: p.skillIndex, uniEquipId: p.uniEquipId ?? null });
  return Object.freeze(out);
}

/** One room: 4 seat slots, host, difficulty, optional running match. */
export class Room {
  /** @param {string} code @param {'solo'|'coop'} mode @param {string} difficulty @param {number} now */
  constructor(code, mode, difficulty, now, capacity = DEFAULT_SEATS) {
    this.code = code;
    this.mode = mode;
    this.difficulty = difficulty;
    /** @type {string | null} */
    this.hostId = null;
    /** @type {(Seat | null)[]} */
    this.capacity = roomCapacity(mode, capacity);
    this.capacityLocked = false;
    this.seats = new Array(this.capacity).fill(null);
    /** @type {{ playerId: string, name: string, connected: boolean }[]} spectator seats, ≤ MAX_SPECTATORS (header) */
    this.spectators = [];
    /** @type {any} running Match instance */
    this.match = null;
    /** @type {{ live: boolean, ended: boolean, disposed: boolean, match: any } | null} */
    this.matchCtx = null;
    this.matchCount = 0;
    /** @type {any} summary passed to onEnd by the last match */
    this.lastSummary = null;
    /**
     * Frames of the last match's end, replayed on resync to humans who have not moved on yet.
     * @type {{ publicFrame: string | null, frames: Map<string, string>, pending: Set<string> } | null}
     */
    this.replay = null;
    /** @type {string | null} per-network limit key of the creator (net.js clientAddress) */
    this.ownerKey = null;
    /** @type {string | null} per-network limit key of whoever started the running match */
    this.matchKey = null;
    this.createdAt = now;
    this.disposed = false;
    this.matchmaking = false;
    this.matchmakingParty = false;
    this.matchmakingSince = null;
    // Four-solo matches stay chat-free; manually formed parties keep their room chat.
    this.chatEnabled = false;
    this.chatMessages = [];
    this.chatSeq = 0;
    this.chatSentAt = new Map();
    this.visibility = 'private'; // older clients must never accidentally publish a room
    this.mapVersion = 'official';
    this.gameMode = 'normal';
    this.extensions = roomExtensions.defaults();
    this.recruitment = null;
    this.recruitNextAt = 0;
    this.description = '';
  }

  /** @param {string} playerId @returns {Seat | null} */
  seatOf(playerId) {
    for (const s of this.seats) if (s && s.playerId === playerId) return s;
    return null;
  }

  /** @param {string} playerId @returns {{ playerId: string, name: string, connected: boolean } | null} */
  spectatorOf(playerId) { return this.spectators.find((s) => s.playerId === playerId) || null; }

  /** Lowest free seat index, or -1. */
  freeSeat() { return this.seats.indexOf(null); }

  /** Humans that have not departed, in seat order. @returns {Seat[]} */
  activeHumans() { return this.seats.filter((s) => s && !s.isBot && !s.left); }

  /** `room.state` frame (DESIGN §8.1) plus `inMatch`. */
  toState() {
    return {
      t: 'room.state',
      code: this.code,
      hostId: this.hostId,
      mode: this.mode,
      difficulty: this.difficulty,
      capacity: this.capacity,
      capacityLocked: this.capacityLocked,
      visibility: this.visibility,
      mapVersion: this.mapVersion,
      gameMode: this.gameMode,
      extensions: this.extensions, extensionCatalog: roomExtensions.catalog(),
      recruitNextAt: this.recruitNextAt,
      description: this.description,
      inMatch: !!this.match,
      ...(this.matchmaking ? { matchmaking: true } : {}),
      ...(this.matchmakingParty ? { matchmakingParty: true } : {}),
      ...(this.chatEnabled ? { chatEnabled: true } : {}),
      seats: this.seats.map((s) => (s
        ? { seat: s.seat, playerId: s.playerId, name: s.name, isBot: s.isBot, ready: s.ready, connected: s.connected && !s.left }
        : null)),
      spectators: this.spectators.map((s) => ({ playerId: s.playerId, name: s.name, connected: s.connected })),
    };
  }
}

/** Room registry + lobby message handlers. Pass an instance as the `handler` of net.js Network. */
export class Lobby {
  /**
   * @param {{
   *   registry: import('./net.js').SessionRegistry,
   *   log?: { info: Function, warn: Function, error: Function, debug?: Function },
   *   MatchClass?: new (opts: object) => any,
   *   getData?: () => object,
   *   now?: () => number,
   *   seedFn?: () => number,
   *   options?: Partial<typeof LOBBY_DEFAULTS>,
   * }} opts
   */
  constructor({ registry, log = noopLog, MatchClass = DefaultMatch, VersusMatchClass = VersusMatch, getData = defaultGetData, now = Date.now, seedFn, options = {}, accounts = null }) {
    this.registry = registry;
    this.log = log;
    this.MatchClass = MatchClass;
    this.VersusMatchClass = VersusMatchClass;
    this.getData = getData;
    this.now = now;
    this.seedFn = seedFn || (() => randomInt(2 ** 32));
    this.accounts = accounts;
    this.social = new FriendRooms(this, { send: sendSession, fail, OK, ERR });
    this.opts = { ...LOBBY_DEFAULTS, ...options };
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    this.directoryCache = null;
    /** @type {Map<string, NodeJS.Timeout>} lobby grace timers by playerId */
    this.graceTimers = new Map();
    /** @type {Map<string, NodeJS.Timeout>} deferred (coalesced) resyncs by playerId */
    this.resyncTimers = new Map();
    /** per-network limit warnings: at most one log line per 10 s (the rest are counted) */
    this.limitLog = { at: -Infinity, suppressed: 0 };
  }

  /** @param {string} code @returns {Room | null} */
  getRoom(code) { return this.rooms.get(String(code).toUpperCase()) || null; }

  /** Counters for /healthz. */
  stats() {
    let matches = 0;
    let humans = 0;
    let bots = 0;
    let spectators = 0;
    let onlineHumans = 0, onlineSpectators = 0, roomsOnline = 0, matchesOnline = 0, waitingRooms = 0, botsInOnlineRooms = 0;
    for (const r of this.rooms.values()) {
      if (r.match) matches++;
      else waitingRooms++;
      for (const s of r.seats) if (s && !s.left) (s.isBot ? bots++ : humans++);
      spectators += r.spectators.length;
      let members = 0;
      for (const session of this.memberSessions(r)) {
        members++;
        if (r.spectatorOf(session.playerId)) onlineSpectators++;
        else onlineHumans++;
      }
      if (members) {
        roomsOnline++;
        if (r.match) matchesOnline++;
        botsInOnlineRooms += r.seats.filter(s => s && !s.left && s.isBot).length;
      }
    }
    let onlineMatching = 0, onlineInMatches = 0;
    for (const r of this.rooms.values()) for (const s of this.memberSessions(r)) {
      if (!r.seatOf(s.playerId)) continue;
      if (r.match) onlineInMatches++;
      else if (r.matchmaking) onlineMatching++;
    }
    let onlinePlayers = 0;
    for (const session of this.registry.all()) if (session.connected) onlinePlayers++;
    return { rooms: this.rooms.size, matches, humans, bots, spectators, onlinePlayers, onlineHumans, onlineSpectators, onlineMatching, onlineInMatches,
      offlineHumans: humans - onlineHumans, onlineInLobby: Math.max(0, onlinePlayers - onlineHumans - onlineSpectators),
      roomsOnline, roomsOffline: this.rooms.size - roomsOnline, matchesOnline, matchesOffline: matches - matchesOnline,
      waitingRooms, botsInOnlineRooms, botsInOfflineRooms: bots - botsInOnlineRooms };
  }

  // ---------------------------------------------------------------------------------------------------
  // net.js handler interface
  // ---------------------------------------------------------------------------------------------------

  /**
   * After `welcome`: resend room state / match state for resumed (or repeated) hellos.
   * @param {import('./net.js').Session} session
   * @param {{ resumed: boolean, repeat: boolean }} info
   */
  onHello(session, { resumed, repeat }) {
    if (!resumed && !repeat) return;
    const room = this.roomOf(session);
    if (!room) {
      if (session.notice) {
        sendSession(session, { t: 'room.closed', reason: session.notice });
        session.notice = null;
      }
      if (session.pendingResult) {
        for (const frame of session.pendingResult) if (frame) sendEncoded(session.ws, JSON.parse(frame), frame);
        session.pendingResult = null;
      }
      return;
    }
    session.notice = null;
    session.pendingResult = null;
    // a player seat, or a spectator seat (header): both carry `connected` / `name`
    const seat = room.seatOf(session.playerId) || room.spectatorOf(session.playerId);
    this.clearGrace(session.playerId);
    // Only a visible change (reconnect, rename, new host) is broadcast; a plain resync (repeated hello on a
    // live socket) answers the requester alone, so hello spam cannot amplify into room-wide traffic.
    let changed = !seat.connected;
    seat.connected = true;
    if (!room.match) seat.accountId = session.accountId;
    if (!room.match && seat.name !== session.name) { seat.name = session.name; changed = true; }
    if (!room.hostId) { this.migrateHost(room); changed = true; }
    if (changed) this.broadcastState(room);
    else this.sendState(room, session);
    this.resync(session, !resumed);
  }

  /**
   * Validated client message from an identified session.
   * @param {import('./net.js').Session} session
   * @param {any} msg
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  onMessage(session, msg) {
    if (this.draining && (msg.t.startsWith('room.') && !['room.leave', 'room.chat', 'room.cancelMatchmaking'].includes(msg.t))) return fail(ERR.WRONG_PHASE, '新版本已上线，本局可继续；结束后请重新打开网页');
    const waiting = this.roomOf(session);
    if (waiting?.matchmaking && !waiting.match && [
      'room.ready', 'room.setDifficulty', 'room.setCapacity', 'room.addBot', 'room.removeBot', 'room.kick',
      'room.start', 'room.removeSpectator', 'room.setVisibility', 'room.setMapVersion', 'room.setGameMode', 'room.setDescription', 'room.recruit', 'room.setExtensions',
    ].includes(msg.t)) return fail(ERR.WRONG_PHASE, '匹配期间人数和席位已锁定，请先取消匹配');
    switch (msg.t) {
      case 'room.setExtensions': return this.setExtensions(session, msg);
      case 'friends.state': case 'friends.send': case 'friends.decide': case 'friends.enter': return this.social.handle(session, msg);
      case 'room.list': return this.listRooms(session);
      case 'room.setVisibility': return this.setVisibility(session, msg);
      case 'room.setMapVersion': return this.setMapVersion(session, msg);
      case 'room.setGameMode': return this.setGameMode(session, msg);
      case 'room.recruit': return this.recruit(session, msg);
      case 'room.setDescription': return this.setDescription(session, msg);
      case 'room.matchmake': return this.matchmake(session, msg);
      case 'room.matchmakeParty': return this.matchmakeParty(session);
      case 'room.cancelMatchmaking': return this.cancelMatchmaking(session);
      case 'room.chat': return this.chat(session, msg);
      case 'room.create': return this.create(session, msg);
      case 'room.join': return this.join(session, msg);
      case 'room.leave': return this.leave(session);
      case 'room.ready': return this.ready(session, msg);
      case 'room.setDifficulty': return this.setDifficulty(session, msg);
      case 'room.setCapacity': return this.setCapacity(session, msg);
      case 'room.addBot': return this.addBot(session);
      case 'room.removeBot': return this.removeBot(session, msg);
      case 'room.kick': return this.kick(session, msg);
      case 'room.start': return this.start(session);
      case 'room.loadout': return this.loadout(session, msg);
      case 'room.ownership': return this.ownership(session, msg);
      case 'room.diy': return this.diy(session, msg);
      case 'room.spectate': return this.spectate(session, msg);
      case 'room.removeSpectator': return this.removeSpectator(session, msg);
      default:
        if (typeof msg.t === 'string' && msg.t.startsWith('g.')) return this.routeGame(session, msg);
        return fail(ERR.BAD_MSG, `unhandled type ${String(msg.t).slice(0, 32)}`);
    }
  }

  /** The session's socket closed. @param {import('./net.js').Session} session */
  onDisconnect(session) {
    this.clearResync(session.playerId); // the next resume resyncs immediately
    const room = this.roomOf(session);
    // a solo run may be resumed within singleReconnectTime (24 h); everything else keeps the registry's window
    session.resumeWindowMs = room && room.match && room.mode === 'solo' ? this.soloResumeWindowMs() : null;
    if (!room) return;
    if (room.matchmaking && !room.match) {
      if (room.matchmakingParty) this.cancelPartyQueue(room);
      else {
        this.removeMember(room, session.playerId);
        session.notice = 'matchmaking_disconnected';
        return;
      }
    }
    const player = room.seatOf(session.playerId);
    const seat = player || room.spectatorOf(session.playerId);
    seat.connected = false;
    // a spectator's seat is kept like a player's (nothing to tell the match: it plays no field)
    if (room.match) { if (player) this.callMatch(room, 'onDisconnect', session.playerId); } else this.startGrace(room, seat);
    this.broadcastState(room);
  }

  /** The session's reconnect window elapsed (already removed from the registry). */
  onExpire(session) {
    session.notice = null;
    session.pendingResult = null;
    this.clearResync(session.playerId);
    const code = session.roomCode;
    session.roomCode = null;
    const room = code ? this.rooms.get(code) : null;
    if (room) this.removeMember(room, session.playerId);
  }

  /**
   * Dispose every room (notifying members with room.closed) — used on server shutdown.
   * @param {string} [reason]
   */
  shutdown(reason = 'shutdown') {
    for (const room of [...this.rooms.values()]) this.disposeRoom(room, reason);
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    for (const t of this.resyncTimers.values()) clearTimeout(t);
    this.resyncTimers.clear();
  }

  // ---------------------------------------------------------------------------------------------------
  // room.* handlers
  // ---------------------------------------------------------------------------------------------------

  /** Individual quick matching; queued parties are indivisible and filled only at start. */
  matchmake(session, { difficulty, capacity, experimentalAccepted }) {
    const cur = this.roomOf(session);
    const size = roomCapacity('coop', capacity ?? cur?.capacity);
    if (cur?.match) return fail(ERR.ROOM_STARTED, 'leave your running match first');
    if (cur && !cur.matchmaking) return fail(ERR.ALREADY, 'leave your private room first');
    if (cur?.matchmakingParty) return fail(ERR.ALREADY, 'cancel your party queue first');
    if (cur && cur.capacity !== size) return fail(ERR.WRONG_PHASE, '快速匹配人数已锁定，请先取消匹配');
    if (size > DEFAULT_SEATS && !cur && experimentalAccepted !== true) return fail(ERR.BAD_MSG, '请先确认5-8人测试模式提醒');
    if (cur?.difficulty === difficulty) { this.sendState(cur, session); return OK; }
    const room = [...this.rooms.values()].find((r) => r.matchmaking && !r.matchmakingParty && !r.match && !r.disposed
      && r.difficulty === difficulty && r.capacity === size && r.freeSeat() >= 0
      && r.activeHumans().every((s) => s.connected));
    const result = room
      ? this.join(session, { code: room.code }, true)
      : this.create(session, { mode: 'coop', difficulty, capacity: size, experimentalAccepted: true }, true);
    if (result.error) return result;
    return this.tryMatchmaking(difficulty, size);
  }

  /** The host queues two or three connected, ready friends without breaking up their room. */
  matchmakeParty(session) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.matchmaking) {
      if (!room.matchmakingParty) return fail(ERR.WRONG_PHASE);
      this.sendState(room, session);
      return OK;
    }
    const humans = room.activeHumans();
    if (Object.entries(room.extensions).some(([id, value]) => value !== roomExtensions.defaults()[id])) return fail(ERR.WRONG_PHASE, '自定义房间请邀请好友；恢复默认规则后可组队匹配');
    if (room.mode !== 'coop' || humans.length < 2 || humans.length >= room.capacity
      || room.seats.some((s) => s?.isBot) || room.spectators.length) {
      return fail(ERR.BAD_MSG, '组队匹配需要至少两位玩家且留有空位，不支持AI或观战者');
    }
    if (humans.some((s) => !s.connected || (s.playerId !== room.hostId && !s.ready))) return fail(ERR.NOT_READY);
    room.matchmaking = true;
    room.matchmakingParty = true;
    room.matchmakingSince = this.now();
    room.chatEnabled = true;
    for (const seat of humans) this.dropReplay(room, seat.playerId);
    this.broadcastState(room);
    return this.tryMatchmaking(room.difficulty, room.capacity);
  }

  /** Pick 2+2, 2+1+1, 3+1 or four singles. Only a complete team changes rooms. */
  tryMatchmaking(difficulty, capacity = DEFAULT_SEATS) {
    const waiting = [...this.rooms.values()].filter((r) => r.matchmaking && !r.match && !r.disposed
      && r.difficulty === difficulty && r.capacity === capacity && r.activeHumans().every((s) => s.connected))
      .sort((a, b) => (a.matchmakingSince ?? a.createdAt) - (b.matchmakingSince ?? b.createdAt));
    const parties = waiting.filter((r) => r.matchmakingParty);
    const singles = waiting.filter((r) => !r.matchmakingParty)
      .flatMap((room) => room.activeHumans().map((seat) => ({ room, seat })));
    let target = null, selected = [];
    for (const party of parties) {
      const members = party.activeHumans();
      const missing = capacity - members.length;
      // Subset sums preserve whole friend groups, including 2+3, 3+3+1, and 2+2+2+2.
      const combinations = new Map([[0, []]]);
      for (const other of parties) {
        if (other === party) continue;
        const size = other.activeHumans().length;
        for (const [sum, groups] of [...combinations]) {
          if (sum + size <= missing && !combinations.has(sum + size)) combinations.set(sum + size, [...groups, other]);
        }
      }
      const filled = [...combinations.keys()].sort((a, b) => b - a).find((sum) => singles.length >= missing - sum);
      if (filled !== undefined) {
        target = party;
        selected = [...members.map((seat) => ({ room: party, seat })),
          ...combinations.get(filled).flatMap((room) => room.activeHumans().map((seat) => ({ room, seat }))),
          ...singles.slice(0, missing - filled)];
        break;
      }
    }
    if (!target && singles.length >= capacity) {
      selected = singles.slice(0, capacity);
      target = selected[0].room;
    }
    if (!target) return OK;
    for (const { room, seat } of selected) {
      if (room !== target) {
        const member = this.registry.byId(seat.playerId);
        this.removeMember(room, seat.playerId, true);
        seat.seat = target.freeSeat();
        target.seats[seat.seat] = seat; // retain each player's loadout and selected supports
        member.roomCode = target.code;
        member.notice = null;
        member.pendingResult = null;
      }
      seat.ready = true;
    }
    if (capacity > PREVIEW_BATTLE_CAPACITY) {
      target.matchmaking = false;
      target.matchmakingParty = false;
      target.matchmakingSince = null;
    }
    this.broadcastState(target);
    for (const member of this.memberSessions(target)) this.sendChatHistory(target, member);
    if (capacity > PREVIEW_BATTLE_CAPACITY) return OK;
    const host = this.registry.byId(target.hostId);
    const started = host?.connected ? this.start(host, true) : fail(ERR.NOT_READY);
    if (started.error) this.disposeRoom(target, 'matchmaking_failed');
    return started;
  }

  cancelPartyQueue(room) {
    room.matchmaking = false;
    room.matchmakingParty = false;
    room.matchmakingSince = null;
    this.broadcastState(room);
  }

  cancelMatchmaking(session) {
    const room = this.roomOf(session);
    // A cancellation delivered after the fourth player arrived must never leave a running match.
    if (room?.match) return fail(ERR.ROOM_STARTED);
    if (room && !room.matchmaking) return fail(ERR.WRONG_PHASE);
    if (room?.matchmakingParty) { this.cancelPartyQueue(room); return OK; }
    if (room) this.removeMember(room, session.playerId);
    sendSession(session, { t: 'room.closed', reason: 'matchmaking_cancelled' });
    return OK;
  }

  create(session, { mode, difficulty, capacity, experimentalAccepted, visibility = 'private', mapVersion = 'official', description, gameMode = 'normal' }, matchmaking = false) {
    if (!validGameMode(gameMode) || (gameMode !== 'normal' && (mode !== 'coop' || matchmaking))) return fail(ERR.BAD_MSG);
    if (!validVisibility(visibility) || !validMapVersion(mapVersion)) return fail(ERR.BAD_MSG);
    if (description !== undefined && !validRecruitment(description)) return fail(ERR.BAD_MSG);
    if (mode === 'coop' && !matchmaking && visibility === 'public' && !validRecruitment(description)) return fail(ERR.BAD_MSG, '请填写房间简介');
    const cur = this.roomOf(session);
    const size = gameMode === 'versus' ? 4 : roomCapacity(mode, capacity);
    if (size > DEFAULT_SEATS && experimentalAccepted !== true) return fail(ERR.BAD_MSG, '请先确认5-8人测试模式提醒');
    if (cur && cur.match) return fail(ERR.ROOM_STARTED, 'leave your running match first');
    if (this.rooms.size >= this.opts.maxRooms) return fail(ERR.INTERNAL, 'too many rooms');
    const key = session.limitKey || null;
    if (key && this.opts.maxRoomsPerAddr > 0) {
      // The room being left disappears with this create when the creator is its only human (a spectator is none).
      const leaving = cur && cur.ownerKey === key && cur.activeHumans().length === 1 && !cur.spectatorOf(session.playerId) ? 1 : 0;
      if (this.countRooms((r) => r.ownerKey === key) - leaving >= this.opts.maxRoomsPerAddr) {
        this.limitWarn(`room limit (${this.opts.maxRoomsPerAddr}) reached for ${session.addr}`);
        return fail(ERR.RATE, 'too many rooms from your network');
      }
    }
    const code = this.genCode();
    if (!code) return fail(ERR.INTERNAL, 'no room code available');
    if (cur) this.removeMember(cur, session.playerId);
    const room = new Room(code, mode, gameMode === 'versus' ? 'HARD' : difficulty, this.now(), size);
    room.visibility = mode === 'coop' && !matchmaking ? visibility : 'private';
    room.mapVersion = mapVersion;
    room.gameMode = gameMode;
    room.description = description === undefined ? '' : sanitizeChat(description);
    room.capacityLocked = matchmaking;
    room.matchmaking = matchmaking;
    room.matchmakingSince = matchmaking ? this.now() : null;
    room.chatEnabled = mode === 'coop' && (!matchmaking || size > DEFAULT_SEATS);
    room.ownerKey = key;
    room.seats[0] = this.humanSeat(0, session);
    room.hostId = session.playerId;
    this.rooms.set(code, room);
    session.roomCode = code;
    session.notice = null;
    session.pendingResult = null;
    this.log.info(`[lobby] ${code} created (${mode}/${difficulty}) by ${session.name}`);
    this.broadcastState(room);
    this.sendChatHistory(room, session);
    return OK;
  }

  /** A cached, bounded-by-maxRooms directory; encoding is shared by all lobby viewers. */
  listRooms(session) {
    const now = this.now();
    if (!this.directoryCache || now - this.directoryCache.at >= 1000) {
      const rooms = [];
      for (const room of this.rooms.values()) {
        const host = room.seatOf(room.hostId);
        if (room.disposed || room.mode !== 'coop' || room.visibility !== 'public' || room.matchmaking
          || !host?.connected || host.left) continue;
        const occupied = room.seats.filter((s) => s && !s.left).length;
        rooms.push({ code: room.code, name: host.name, capacity: room.capacity, occupied,
          difficulty: room.difficulty, mapVersion: room.mapVersion, gameMode: room.gameMode, description: room.description, inMatch: !!room.match,
          spectatorCount: room.spectators.length, createdAt: room.createdAt,
          ...(!room.match && occupied < room.capacity && room.recruitment ? { recruitment: room.recruitment } : {}) });
      }
      rooms.sort((a, b) => Number(a.inMatch) - Number(b.inMatch) || b.createdAt - a.createdAt || a.code.localeCompare(b.code));
      this.directoryCache = { at: now, encoded: encode({ t: 'room.directory', rooms, serverNow: now }) };
    }
    sendRaw(session.ws, this.directoryCache.encoded);
    return OK;
  }

  editableRoom(session) {
    const room = this.roomOf(session);
    if (!room) return { error: ERR.NOT_IN_ROOM };
    if (room.hostId !== session.playerId) return { error: ERR.NOT_HOST };
    if (room.match) return { error: ERR.ROOM_STARTED };
    if (room.matchmaking) return { error: ERR.WRONG_PHASE };
    return { room };
  }

  setExtensions(session, { extensions }) {
    if (!roomExtensions.validate(extensions)) return fail(ERR.BAD_MSG, '扩展设置含未知选项或超出范围');
    const res = this.editableRoom(session);
    if (res.error) return res;
    if (res.room.gameMode === 'versus') return fail(ERR.WRONG_PHASE, '对抗测试暂不支持房间扩展');
    const next = roomExtensions.normalize({ ...res.room.extensions, ...extensions });
    if (JSON.stringify(next) === JSON.stringify(res.room.extensions)) return OK;
    res.room.extensions = next;
    this.dropReplay(res.room, session.playerId);
    for (const seat of res.room.seats) if (seat && !seat.isBot) seat.ready = false;
    this.broadcastState(res.room);
    return OK;
  }

  setVisibility(session, { visibility }) {
    if (!validVisibility(visibility)) return fail(ERR.BAD_MSG);
    const res = this.editableRoom(session);
    if (res.error) return res;
    const room = res.room;
    if (room.mode !== 'coop') return fail(ERR.WRONG_PHASE);
    if (visibility === 'public' && !validRecruitment(room.description)) return fail(ERR.BAD_MSG, '请先填写房间简介');
    room.visibility = visibility;
    if (visibility === 'private') room.recruitment = null;
    // Cooldown belongs to the room: switching visibility or hosts cannot reset it.
    this.broadcastState(room);
    return OK;
  }

  setMapVersion(session, { mapVersion }) {
    if (!validMapVersion(mapVersion)) return fail(ERR.BAD_MSG);
    const res = this.editableRoom(session);
    if (res.error) return res;
    res.room.mapVersion = mapVersion;
    this.broadcastState(res.room);
    return OK;
  }

  setGameMode(session, { gameMode }) {
    if (!validGameMode(gameMode)) return fail(ERR.BAD_MSG);
    const res = this.editableRoom(session);
    if (res.error) return res;
    const room = res.room;
    if (room.mode !== 'coop') return fail(ERR.WRONG_PHASE);
    if (room.gameMode === gameMode) return OK;
    if (gameMode === 'versus') {
      const occupied = room.seats.filter(Boolean);
      if (occupied.length > 4) return fail(ERR.ROOM_FULL, '对抗模式（测试）只支持4人，请先移出多余成员');
      room.capacity = 4;
      room.seats = [...occupied, ...Array(4 - occupied.length).fill(null)];
      room.difficulty = 'HARD';
      room.extensions = roomExtensions.defaults();
    }
    this.dropReplay(room, session.playerId);
    room.gameMode = gameMode;
    for (const seat of room.seats) if (seat && !seat.isBot) seat.ready = false;
    this.broadcastState(room);
    return OK;
  }

  setDescription(session, { description }) {
    if (!validRecruitment(description)) return fail(ERR.BAD_MSG);
    const res = this.editableRoom(session);
    if (res.error) return res;
    res.room.description = sanitizeChat(description);
    if (res.room.recruitment) res.room.recruitment.text = res.room.description;
    this.broadcastState(res.room);
    return OK;
  }

  recruit(session) {
    const res = this.editableRoom(session);
    if (res.error) return res;
    const room = res.room;
    if (room.mode !== 'coop' || room.visibility !== 'public') return fail(ERR.WRONG_PHASE, '仅公开房间可以发布招募');
    if (!validRecruitment(room.description)) return fail(ERR.BAD_MSG, '请先填写房间简介');
    if (room.freeSeat() < 0) return fail(ERR.ROOM_FULL);
    const now = this.now();
    if (now < room.recruitNextAt) return fail(ERR.RATE, '发布招募需间隔10秒');
    room.recruitment = { text: room.description, at: now };
    room.recruitNextAt = now + RECRUIT_INTERVAL_MS;
    this.broadcastState(room);
    return OK;
  }

  join(session, { code }, matchmaking = false) {
    const norm = String(code).trim().toUpperCase();
    const room = norm.length === ROOM_CODE_LEN ? this.rooms.get(norm) : undefined;
    if (!room) return fail(ERR.ROOM_NOT_FOUND);
    const cur = this.roomOf(session);
    // idempotent for members; a spectator of this room goes on below: it may take a free player seat (header)
    if (cur === room && !room.spectatorOf(session.playerId)) { this.sendState(room, session); return OK; }
    if (room.matchmaking && !room.match && !matchmaking) return fail(ERR.WRONG_PHASE, 'use quick match');
    if (cur && cur.match) return fail(ERR.ROOM_STARTED, 'leave your running match first');
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.mode === 'solo') return fail(ERR.ROOM_FULL, 'solo room');
    const idx = room.freeSeat();
    if (idx < 0) return fail(ERR.ROOM_FULL);
    if (cur) this.removeMember(cur, session.playerId);
    room.seats[idx] = this.humanSeat(idx, session);
    session.roomCode = room.code;
    session.notice = null;
    session.pendingResult = null;
    if (!room.hostId) room.hostId = session.playerId;
    this.broadcastState(room);
    this.sendChatHistory(room, session);
    return OK;
  }

  /** Only current members of a manually created co-op room can send, in any game phase. */
  chat(session, { text }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (!room.chatEnabled) return fail(ERR.WRONG_PHASE, 'chat is only available in friend rooms');
    if (!validChat(text)) return fail(ERR.BAD_MSG, 'empty or oversized chat message');
    const at = this.now();
    const previous = room.chatSentAt.get(session.playerId);
    if (previous != null && at - previous < CHAT_INTERVAL_MS) return fail(ERR.RATE, 'chat cooldown');
    const member = room.seatOf(session.playerId) || room.spectatorOf(session.playerId);
    const message = { id: ++room.chatSeq, playerId: session.playerId, name: member.name, text: sanitizeChat(text), at };
    room.chatSentAt.set(session.playerId, at);
    room.chatMessages.push(message);
    if (room.chatMessages.length > CHAT_HISTORY_LIMIT) room.chatMessages.shift();
    this.broadcastRoom(room, { t: 'room.chat', code: room.code, message });
    return OK;
  }

  sendChatHistory(room, session) {
    if (room.chatEnabled) sendSession(session, { t: 'room.chatHistory', code: room.code, messages: room.chatMessages });
  }

  leave(session) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    this.removeMember(room, session.playerId);
    return OK;
  }

  /**
   * room.spectate: one of a co-op room's MAX_SPECTATORS spectator seats, in its lobby or during its match (header). In a
   * running match the match registers the spectator and resends what it may see (Match.addSpectator).
   */
  spectate(session, { code }) {
    const norm = String(code).trim().toUpperCase();
    const room = norm.length === ROOM_CODE_LEN ? this.rooms.get(norm) : undefined;
    if (!room) return fail(ERR.ROOM_NOT_FOUND);
    if (room.matchmaking && !room.match) return fail(ERR.WRONG_PHASE, 'matchmaking is not a spectator lobby');
    const cur = this.roomOf(session);
    if (cur === room) {
      if (!room.spectatorOf(session.playerId)) return fail(ERR.ALREADY, 'seated as a player');
      this.sendState(room, session);
      return OK;
    }
    if (cur && cur.match) return fail(ERR.ROOM_STARTED, 'leave your running match first');
    if (room.mode === 'solo') return fail(ERR.ROOM_FULL, 'solo room');
    if (room.spectators.length >= MAX_SPECTATORS) return fail(ERR.ROOM_FULL, 'no free spectator seat');
    if (cur) this.removeMember(cur, session.playerId);
    room.spectators.push({ playerId: session.playerId, name: session.name, connected: session.connected });
    session.roomCode = room.code;
    session.notice = null;
    session.pendingResult = null;
    this.broadcastState(room);
    if (room.match) this.callMatch(room, 'addSpectator', session.playerId);
    this.sendChatHistory(room, session);
    return OK;
  }

  /** room.removeSpectator (host, any time): the spectator gets room.closed {kicked} and its seat is freed. */
  removeSpectator(session, { playerId }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (!room.spectatorOf(playerId)) return fail(ERR.BAD_TARGET, 'not a spectator of this room');
    const target = this.registry.byId(playerId);
    const wasHere = !!target && target.roomCode === room.code;
    const replay = this.replayFor(room, playerId);
    this.removeMember(room, playerId);
    if (wasHere) {
      // like room.kick: now, or on the next resume (with the result replay, as after the grace timeout)
      if (target.connected) sendSession(target, { t: 'room.closed', reason: 'kicked' });
      else { target.notice = 'kicked'; target.pendingResult = replay; }
    }
    return OK;
  }

  ready(session, { ready }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    const seat = room.seatOf(session.playerId);
    if (seat.ready !== ready) {
      seat.ready = ready;
      this.broadcastState(room);
    }
    return OK;
  }

  setDifficulty(session, { difficulty }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    if (room.difficulty !== difficulty) {
      room.difficulty = difficulty;
      for (const s of room.seats) if (s && !s.isBot && s.playerId !== room.hostId) s.ready = false;
      this.broadcastState(room);
    }
    return OK;
  }

  setCapacity(session, { capacity, experimentalAccepted }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.mode !== 'coop' || room.capacityLocked || room.matchmaking) return fail(ERR.WRONG_PHASE, '此房间人数已锁定');
    if (!ROOM_CAPACITIES.includes(capacity)) return fail(ERR.BAD_MSG);
    if (room.gameMode === 'versus' && capacity !== 4) return fail(ERR.BAD_MSG, '对抗模式（测试）固定为4人房');
    if (capacity === room.capacity) return OK;
    if (capacity > DEFAULT_SEATS && experimentalAccepted !== true) return fail(ERR.BAD_MSG, '请先确认5-8人测试模式提醒');
    const occupied = room.seats.filter(Boolean);
    if (occupied.length > capacity) return fail(ERR.ROOM_FULL, '当前成员超过所选人数，请先移出多余成员');
    this.dropReplay(room, session.playerId);
    if (capacity < room.capacity) {
      room.seats = occupied.map((seat, index) => ({ ...seat, seat: index }));
      while (room.seats.length < capacity) room.seats.push(null);
    } else {
      while (room.seats.length < capacity) room.seats.push(null);
    }
    room.capacity = capacity;
    for (const seat of room.seats) if (seat && !seat.isBot && seat.playerId !== room.hostId) seat.ready = false;
    this.broadcastState(room);
    return OK;
  }

  addBot(session) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    if (room.mode === 'solo') return fail(ERR.ROOM_FULL, 'solo rooms cannot have AI teammates');
    const idx = room.freeSeat();
    if (idx < 0) return fail(ERR.ROOM_FULL);
    const used = new Set(room.seats.filter((s) => s && s.isBot).map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `AI·${idx + 1}`;
    let playerId;
    do playerId = 'ai_' + randomBytes(4).toString('hex'); while (room.seatOf(playerId));
    room.seats[idx] = { seat: idx, playerId, name, isBot: true, ready: true, connected: true, left: false };
    this.broadcastState(room);
    return OK;
  }

  removeBot(session, { seat }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    const target = room.seats[seat];
    if (!target || !target.isBot) return fail(ERR.BAD_TARGET, 'seat does not hold an AI');
    room.seats[seat] = null;
    this.broadcastState(room);
    return OK;
  }

  /** Host removes another human before the match (header: room.kick). */
  kick(session, { seat, playerId }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    const target = room.seats[seat];
    if (!target || target.left) return fail(ERR.BAD_TARGET, 'seat holds no player');
    if (target.playerId !== playerId) return fail(ERR.BAD_TARGET, 'seat changed hands'); // the confirmed player left meanwhile
    if (target.isBot) return fail(ERR.BAD_TARGET, 'seat holds an AI (room.removeBot)');
    if (target.playerId === session.playerId) return fail(ERR.BAD_TARGET, 'cannot kick yourself');
    const kicked = this.registry.byId(target.playerId);
    const wasHere = !!kicked && kicked.roomCode === room.code;
    const replay = this.replayFor(room, target.playerId);
    this.removeMember(room, target.playerId);
    if (wasHere) {
      if (kicked.connected) sendSession(kicked, { t: 'room.closed', reason: 'kicked' });
      else { kicked.notice = 'kicked'; kicked.pendingResult = replay; }
    }
    this.log.info(`[lobby] ${room.code} ${target.name} removed by the host`);
    return OK;
  }

  start(session, matchmaking = false) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.matchmaking && !matchmaking) return fail(ERR.WRONG_PHASE, 'quick match starts automatically');
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.gameMode === 'versus' && (room.capacity !== 4 || room.seats.filter(Boolean).length !== 4)) return fail(ERR.NOT_READY, '对抗模式（测试）必须在4人房间满员后开始');
    const humans = room.activeHumans();
    for (const s of humans) {
      if (s.playerId !== room.hostId && (!s.connected || !s.ready)) return fail(ERR.NOT_READY);
    }
    const bots = room.seats.filter((s) => s && s.isBot);
    if (humans.length < 1 || (room.mode === 'solo' && (humans.length !== 1 || bots.length > 0))) {
      return fail(ERR.BAD_MSG, 'invalid seat configuration');
    }
    const key = session.limitKey || null;
    if (key && this.opts.maxMatchesPerAddr > 0 && this.countRooms((r) => !!r.match && r.matchKey === key) >= this.opts.maxMatchesPerAddr) {
      this.limitWarn(`match limit (${this.opts.maxMatchesPerAddr}) reached for ${session.addr}`);
      return fail(ERR.RATE, 'too many running matches from your network');
    }
    return this.startMatch(room, key);
  }

  /**
   * room.loadout (DESIGN §16): check the operator loadout against the game data, store it on the session and the seat,
   * and — while a match runs — hand it to the match (accepted only during INFO_CHECK, see the header).
   */
  loadout(session, { entries }) {
    const data = this.safeData();
    const res = checkLoadout(entries, (id) => lookup('chess', id, data));
    if (!res || res.error) return fail(res && isErrCode(res.error) ? res.error : ERR.BAD_MSG, res && res.detail);
    const loadout = freezeLoadout(res.loadout);
    session.loadout = loadout;
    const room = this.roomOf(session);
    if (!room) return OK;
    const seat = room.seatOf(session.playerId);
    if (seat) seat.loadout = loadout;
    if (!room.match || !seat) return OK; // a spectator's loadout stays on its session, never reaching the match
    if (typeof room.match.setLoadout !== 'function') return fail(ERR.ROOM_STARTED, 'stored for the next match');
    let r;
    try {
      r = room.match.setLoadout(session.playerId, loadout);
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match.setLoadout threw`, e);
      return fail(ERR.INTERNAL);
    }
    if (room.match.asyncMatch && r && typeof r.then === 'function') return r;
    if (r && typeof r === 'object' && r.error) {
      return fail(isErrCode(r.error) ? r.error : ERR.INTERNAL, typeof r.detail === 'string' ? r.detail : undefined);
    }
    return OK;
  }

  /**
   * room.ownership (0.2.0 补位): keep the droppable chess of the not-owned list, store it on the session and the seat
   * (see the header). A running match never takes it: it keeps the list its seat had at its start.
   */
  ownership(session, { notOwned }) {
    const data = this.safeData();
    const res = checkNotOwned(notOwned, (id) => lookup('chess', id, data));
    if (!res || res.error) return fail(ERR.BAD_MSG, res && res.detail);
    const list = Object.freeze(res.notOwned.slice());
    session.notOwned = list;
    const room = this.roomOf(session);
    if (!room) return OK;
    const seat = room.seatOf(session.playerId);
    if (seat) seat.notOwned = list;
    if (room.match && seat) return fail(ERR.ROOM_STARTED, 'stored for the next match');
    return OK;
  }

  /**
   * room.diy (0.2.0 自选编队): keep the legal picks (checkDiyPicks against the data and KITTED_CHARS), store them on the
   * session and the seat (see the header). A running match never takes them: it keeps the picks its seat had at its
   * start.
   */
  diy(session, { picks }) {
    const res = checkDiyPicks(picks, { data: this.safeData(), kitted: KITTED_CHARS });
    if (!res || !('ok' in res)) return fail(ERR.BAD_MSG, res && res.detail);
    const kept = freezeDiy(res.picks);
    session.diy = kept;
    const room = this.roomOf(session);
    if (!room) return OK;
    const seat = room.seatOf(session.playerId);
    if (seat) seat.diy = kept;
    if (room.match && seat) return fail(ERR.ROOM_STARTED, 'stored for the next match');
    return OK;
  }

  /** Extra fields of every `welcome` (net.js): the operators a 自选 slot may field (shared/diy.js `kitted`). */
  welcomeInfo() {
    return { diyKitted: KITTED_CHARS };
  }

  // ---------------------------------------------------------------------------------------------------
  // Match wiring
  // ---------------------------------------------------------------------------------------------------

  /** @param {Room} room @param {string | null} [key] per-network limit key of the starter */
  startMatch(room, key = null) {
    if (room.capacity > PREVIEW_BATTLE_CAPACITY) return fail(ERR.WRONG_PHASE, MULTIPLAYER_PENDING);
    const host = room.seatOf(room.hostId);
    if (host) host.ready = true;
    const seats = room.seats.filter(Boolean).map((s) => ({
      seat: s.seat, playerId: s.playerId, name: s.name, isBot: s.isBot, connected: s.connected,
      accountId: s.accountId || null,
      // DESIGN §16: the human's checked operator loadout (bots fight with the defaults)
      loadout: s.isBot ? null : s.loadout || null,
      // 0.2.0 补位: the chess the human marked as not owned (bots own every operator)
      notOwned: s.isBot ? null : s.notOwned || null,
      // 0.2.0 自选编队: the human's checked DIY picks (bots field no 自选 piece [ASSUMED])
      diy: s.isBot ? null : s.diy || null,
    }));
    // lastPublic / results: the latest m.public broadcast and the m.result frames (encoded), kept for the replay.
    const ctx = { live: true, ended: false, disposed: false, match: null, lastPublic: null, sharedResult: null, results: new Map() };
    let seed = 0;
    try { seed = this.seedFn() >>> 0; } catch { seed = randomInt(2 ** 32); }
    ctx.leaseId = `${room.code}:${room.matchCount + 1}:${this.now()}:${seed}`;
    ctx.accountIds = new Map(seats.filter(s => s.accountId && !s.isBot).map(s => [s.playerId, s.accountId]));
    this.accounts?.begin(ctx.leaseId, [...ctx.accountIds.values()]).catch(e => this.log.error('[accounts] match lease failed', e.message));
    try {
      const MatchType = room.gameMode === 'versus' ? this.VersusMatchClass : this.MatchClass;
      const match = new MatchType({
        roomCode: room.code,
        mode: room.mode,
        difficulty: room.difficulty,
        modeId: modeIdFor(room.mode, room.difficulty),
        capacity: room.capacity,
        mapVersion: room.mapVersion,
        gameMode: room.gameMode,
        extensions: room.extensions,
        seats,
        // the spectator seats (header): watched like eliminated players, never players
        spectators: room.spectators.map((s) => s.playerId),
        seed,
        // the room's match number: with the seed it keeps battleIds unique across the room's matches (DESIGN §14)
        matchNo: room.matchCount + 1,
        data: this.safeData(),
        log: this.log,
        now: this.now,
        send: (playerId, msg) => (ctx.live ? this.matchSend(room, ctx, playerId, msg) : false),
        sendMany: (playerIds, msg) => (ctx.live ? this.sendBattleToPlayers(room, playerIds, msg) : 0),
        broadcast: (msg) => { if (ctx.live) this.matchBroadcast(room, ctx, msg); },
        onEnd: (summary) => this.onMatchEnd(room, ctx, summary),
        onCrash: () => {
          if (ctx.live && room.matchCtx === ctx && !room.disposed) this.disposeRoom(room, 'shutdown');
        },
        onAfk: (playerId) => {
          if (!ctx.live || room.matchCtx !== ctx || room.disposed) return;
          const target = this.registry.byId(playerId);
          this.removeMember(room, playerId);
          if (target) {
            if (target.connected) sendSession(target, { t: 'room.closed', reason: 'afk' });
            else target.notice = 'afk';
          }
        },
      });
      ctx.match = match;
      room.match = match;
      room.matchCtx = ctx;
      room.matchKey = key;
      room.replay = null;
      room.matchCount++;
      room.recruitment = null;
      this.log.info(`[lobby] ${room.code} match #${room.matchCount} starting (${room.mode}/${room.difficulty}, ${seats.length} seats, seed ${seed})`);
      this.broadcastState(room);
      match.start();
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match failed to start`, e);
      this.accounts?.release(ctx.leaseId).catch(e => this.log.error('[accounts] release failed', e.message));
      if (room.matchCtx === ctx) { room.match = null; room.matchCtx = null; room.matchKey = null; }
      this.disposeMatchCtx(ctx);
      this.broadcastState(room);
      return fail(ERR.INTERNAL, 'match failed to start');
    }
    return OK;
  }

  /** onEnd callback: return the room to LOBBY and dispose the match on the next macrotask. */
  onMatchEnd(room, ctx, summary) {
    if (ctx.ended || !ctx.live || room.matchCtx !== ctx || room.disposed) return;
    ctx.ended = true;
    if (this.accounts && summary) {
      const result = { ...summary, players: (summary.players || []).map(row => ({ ...row, accountId: ctx.accountIds.get(row.playerId) || null })) };
      const meta = { matchId: String(summary.resultId || ctx.leaseId).slice(0, 128), mode: room.mode, difficulty: room.difficulty, rounds: Number(summary.roundsPassed) || 0 };
      this.accounts.finish(ctx.leaseId, summary, result, meta).catch(e => this.log.error('[accounts] settlement failed', e.message));
    } else this.accounts?.release(ctx.leaseId).catch(e => this.log.error('[accounts] release failed', e.message));
    room.lastSummary = summary ?? null;
    room.matchmaking = false; // results return to the ordinary room; a new match needs a new explicit choice
    room.matchmakingParty = false;
    room.matchmakingSince = null;
    room.match = null;
    room.matchCtx = null;
    room.matchKey = null;
    room.replay = this.buildReplay(room, ctx);
    setImmediate(() => this.disposeMatchCtx(ctx));
    this.log.info(`[lobby] ${room.code} match #${room.matchCount} ended`);
    for (let i = 0; i < room.seats.length; i++) {
      const s = room.seats[i];
      if (!s || s.isBot) continue;
      if (s.left) { room.seats[i] = null; continue; }
      s.ready = false;
      if (!s.connected) this.startGrace(room, s);
    }
    for (const s of room.spectators) if (!s.connected) this.startGrace(room, s);
    const host = room.hostId ? room.seatOf(room.hostId) : null;
    if (!host || host.isBot || host.left) this.migrateHost(room);
    if (room.activeHumans().length === 0) this.disposeRoom(room, 'empty');
    else this.broadcastState(room);
  }

  /** Match unicast; m.result frames are also kept for the replay. */
  matchSend(room, ctx, playerId, msg) {
    if (msg && (msg.t === 'm.result' || msg.t === 'm.versus' && msg.state?.room?.status === 'complete')) {
      const data = encode(msg);
      if (data != null) ctx.results.set(playerId, data);
    }
    return this.sendToPlayer(room, playerId, msg);
  }

  /** Match broadcast; the latest m.public and a broadcast m.result are also kept for the replay. */
  matchBroadcast(room, ctx, msg) {
    const data = this.broadcastRoom(room, msg);
    if (data == null) return;
    if (msg.t === 'm.public') ctx.lastPublic = data;
    else if (msg.t === 'm.result') ctx.sharedResult = data;
  }

  /**
   * Replay record for the humans still seated when a match ends (null when the match produced no m.result,
   * e.g. it was abandoned: those clients then see "simulation closed").
   * @param {Room} room @returns {Room['replay']}
   */
  buildReplay(room, ctx) {
    const frames = new Map();
    for (const s of [...room.seats, ...room.spectators]) {
      if (!s || s.isBot || s.left) continue;
      const frame = ctx.results.get(s.playerId) || ctx.sharedResult;
      if (frame) frames.set(s.playerId, frame);
    }
    if (frames.size === 0) return null;
    return { publicFrame: ctx.lastPublic, frames, pending: new Set(frames.keys()) };
  }

  /** The replay frames still owed to a player (null when they moved on). @returns {string[] | null} */
  replayFor(room, playerId) {
    const r = room.replay;
    if (!r || !r.pending.has(playerId)) return null;
    return [r.publicFrame, r.frames.get(playerId)].filter(Boolean);
  }

  /** The player moved on from the result screen (acted in the room, left): stop replaying it. */
  dropReplay(room, playerId) {
    const r = room.replay;
    if (!r || !r.pending.delete(playerId)) return;
    r.frames.delete(playerId);
    if (r.pending.size === 0) room.replay = null;
  }

  /**
   * The heavy part of a resync — full match state (match.onReconnect) or, back in LOBBY, the result replay.
   * Immediate after a (re)connect; for repeated hellos on a live socket at most once per resyncMinGapMs
   * (requests inside the window coalesce into one deferred resync).
   * @param {import('./net.js').Session} session @param {boolean} coalesce
   */
  resync(session, coalesce) {
    const pid = session.playerId;
    if (coalesce) {
      if (this.resyncTimers.has(pid)) return; // the scheduled resync answers this request too
      const wait = (Number.isFinite(session.resyncAt) ? session.resyncAt : -Infinity) + this.opts.resyncMinGapMs - this.now();
      if (wait > 0) {
        const t = setTimeout(() => { this.resyncTimers.delete(pid); this.runResync(session); }, wait);
        t.unref?.();
        this.resyncTimers.set(pid, t);
        return;
      }
    } else {
      this.clearResync(pid);
    }
    this.runResync(session);
  }

  /** @param {import('./net.js').Session} session */
  runResync(session) {
    if (!session.connected || this.registry.byId(session.playerId) !== session) return;
    const room = this.roomOf(session);
    if (!room) return;
    session.resyncAt = this.now();
    this.sendChatHistory(room, session);
    if (room.match) {
      this.callMatch(room, room.spectatorOf(session.playerId) ? 'addSpectator' : 'onReconnect', session.playerId);
      return;
    }
    const frames = this.replayFor(room, session.playerId);
    if (frames) for (const frame of frames) sendEncoded(session.ws, JSON.parse(frame), frame);
  }

  clearResync(playerId) {
    const t = this.resyncTimers.get(playerId);
    if (t) { clearTimeout(t); this.resyncTimers.delete(playerId); }
  }

  /** Log a per-network limit refusal without letting a refusal loop flood the log. */
  limitWarn(text) {
    const now = this.now();
    if (now - this.limitLog.at < 10_000) { this.limitLog.suppressed++; return; }
    const more = this.limitLog.suppressed ? ` (+${this.limitLog.suppressed} similar refusals)` : '';
    this.limitLog.at = now;
    this.limitLog.suppressed = 0;
    this.log.warn(`[lobby] ${text}${more}`);
  }

  /** Number of rooms matching a predicate. */
  countRooms(pred) {
    let n = 0;
    for (const r of this.rooms.values()) if (pred(r)) n++;
    return n;
  }

  /** Route a 'g.*' intent to the running match. */
  routeGame(session, msg) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (!room.match) return fail(ERR.WRONG_PHASE, 'no running match');
    if (msg.t === 'g.leave') {
      this.removeMember(room, session.playerId);
      return OK;
    }
    // a spectator only watches (header): nothing else of it ever reaches the match
    if (msg.t !== 'g.watch' && room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    let res;
    try {
      res = room.match.handle(session.playerId, msg);
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match.handle(${msg.t}) threw`, e);
      return fail(ERR.INTERNAL);
    }
    if (res && typeof res.then === 'function') {
      if (room.match.asyncMatch) return res;
      // Contract violation (handle must be synchronous): never let the rejection go unhandled.
      this.log.error(`[lobby] ${room.code} match.handle(${msg.t}) returned a Promise; it must be synchronous`);
      Promise.resolve(res).catch((e) => this.log.error(`[lobby] ${room.code} match.handle(${msg.t}) rejected`, e));
      return OK;
    }
    if (res && typeof res === 'object' && res.error) {
      return fail(isErrCode(res.error) ? res.error : ERR.INTERNAL, typeof res.detail === 'string' ? res.detail : undefined);
    }
    return OK;
  }

  /** Call an optional match hook without letting it throw. onLeave falls back to onDisconnect. */
  callMatch(room, method, ...args) {
    const m = room.match;
    if (!m) return undefined;
    let fn = m[method];
    if (typeof fn !== 'function' && method === 'onLeave') fn = m.onDisconnect;
    if (typeof fn !== 'function') return undefined;
    try {
      return fn.apply(m, args);
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match.${method} threw`, e);
      return undefined;
    }
  }

  disposeMatchCtx(ctx) {
    if (ctx.disposed) return;
    ctx.disposed = true;
    if (!ctx.ended && ctx.leaseId) this.accounts?.release(ctx.leaseId).catch(error => this.log.error('[accounts] release', error.message));
    ctx.live = false;
    try { ctx.match?.dispose?.(); } catch (e) { this.log.error('[lobby] match.dispose threw', e); }
  }

  safeData() {
    try { return this.getData(); } catch (e) { this.log.error('[lobby] getData failed', e); return Object.freeze({}); }
  }

  /** How long a dropped solo run stays resumable (ms): the option, else data singleReconnectTime, else 24 h. */
  soloResumeWindowMs() {
    const o = this.opts.soloReconnectWindowMs;
    if (typeof o === 'number' && Number.isFinite(o) && o > 0) return o;
    const sec = this.safeData()?.config?.constants?.singleReconnectTime;
    return (typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? sec : SOLO_RECONNECT_FALLBACK_SEC) * 1000;
  }

  // ---------------------------------------------------------------------------------------------------
  // Membership helpers
  // ---------------------------------------------------------------------------------------------------

  /** The session's current room (self-heals stale `roomCode`). @returns {Room | null} */
  roomOf(session) {
    if (!session.roomCode) return null;
    const room = this.rooms.get(session.roomCode);
    const seat = room ? room.seatOf(session.playerId) : null;
    if (room && !seat && room.spectatorOf(session.playerId)) return room; // a spectator seat
    if (!room || !seat || seat.left || seat.isBot) { session.roomCode = null; return null; }
    return room;
  }

  /** @returns {Seat} */
  humanSeat(idx, session) {
    return {
      seat: idx, playerId: session.playerId, name: session.name, isBot: false, ready: false, connected: session.connected, left: false,
      accountId: session.accountId || null,
      loadout: session.loadout || null,
      notOwned: session.notOwned || null,
      diy: session.diy || null,
    };
  }

  /**
   * Remove a human from a room permanently (leave, grace timeout, expiry, switching rooms).
   * In LOBBY the seat is freed; during a match it is marked departed and match.onLeave is called.
   * @param {Room} room @param {string} playerId
   */
  removeMember(room, playerId, matchmakingTransfer = false) {
    if (!matchmakingTransfer && !room.match && room.matchmakingParty && room.seatOf(playerId)) this.cancelPartyQueue(room);
    const session = this.registry.byId(playerId);
    if (session && session.roomCode === room.code) session.roomCode = null;
    this.clearGrace(playerId);
    this.dropReplay(room, playerId);
    room.chatSentAt.delete(playerId);
    if (this.freeSpectatorSeat(room, playerId)) return;
    const seat = room.seatOf(playerId);
    if (!seat || seat.isBot || seat.left || room.disposed) return;
    if (room.match) {
      seat.left = true;
      seat.connected = false;
      seat.ready = false;
      this.callMatch(room, 'onLeave', playerId);
    } else {
      room.seats[seat.seat] = null;
    }
    if (room.disposed) return; // onLeave may have ended the match and emptied the room
    if (room.hostId === playerId) this.migrateHost(room);
    if (room.activeHumans().length === 0) this.disposeRoom(room, 'empty');
    else this.broadcastState(room);
  }

  /**
   * Free a spectator seat (removeMember): the match forgets the spectator; never a host change or a disposal — a
   * spectator neither holds the host nor keeps a room alive. @returns {boolean} true when it was a spectator seat
   */
  freeSpectatorSeat(room, playerId) {
    const i = room.spectators.findIndex((s) => s.playerId === playerId);
    if (i < 0) return false;
    room.spectators.splice(i, 1);
    if (room.disposed) return true;
    this.callMatch(room, 'removeSpectator', playerId);
    this.broadcastState(room);
    return true;
  }

  /** Lowest-seat connected human becomes host (else lowest-seat human, else null). */
  migrateHost(room) {
    const humans = room.activeHumans();
    const pick = humans.find((s) => s.connected) || humans[0] || null;
    const prev = room.hostId;
    room.hostId = pick ? pick.playerId : null;
    if (pick && prev !== pick.playerId) this.log.info(`[lobby] ${room.code} host → ${pick.name}`);
  }

  startGrace(room, seat) {
    const playerId = seat.playerId;
    this.clearGrace(playerId);
    const t = setTimeout(() => {
      this.graceTimers.delete(playerId);
      if (room.disposed || room.match) return;
      const s = room.seatOf(playerId) || room.spectatorOf(playerId);
      if (!s || s.connected) return;
      const session = this.registry.byId(playerId);
      if (session && session.roomCode === room.code) {
        session.notice = 'timeout';
        session.pendingResult = this.replayFor(room, playerId); // still shown after room.closed on resume
      }
      this.removeMember(room, playerId);
    }, this.opts.lobbyGraceMs);
    t.unref?.();
    this.graceTimers.set(playerId, t);
  }

  clearGrace(playerId) {
    const t = this.graceTimers.get(playerId);
    if (t) { clearTimeout(t); this.graceTimers.delete(playerId); }
  }

  /**
   * Delete a room, detach its members (room.closed unless the room simply emptied) and dispose its match.
   * @param {Room} room @param {string} reason
   */
  disposeRoom(room, reason) {
    if (room.disposed) return;
    room.disposed = true;
    this.directoryCache = null;
    if (this.rooms.get(room.code) === room) this.rooms.delete(room.code);
    const ctx = room.matchCtx;
    room.match = null;
    room.matchCtx = null;
    room.matchKey = null;
    room.replay = null;
    for (const s of room.seats) {
      if (!s || s.isBot) continue;
      this.clearGrace(s.playerId);
      const session = this.registry.byId(s.playerId);
      if (!session || session.roomCode !== room.code) continue;
      session.roomCode = null;
      if (s.left || reason === 'empty') continue;
      if (session.connected) sendSession(session, { t: 'room.closed', reason });
      else session.notice = reason;
    }
    // spectators did not leave: they are told whatever closed the room (its last human leaving included)
    for (const s of room.spectators) {
      this.clearGrace(s.playerId);
      const session = this.registry.byId(s.playerId);
      if (!session || session.roomCode !== room.code) continue;
      session.roomCode = null;
      if (session.connected) sendSession(session, { t: 'room.closed', reason });
      else session.notice = reason;
    }
    if (ctx) this.disposeMatchCtx(ctx);
    this.log.info(`[lobby] ${room.code} disposed (${reason})`);
  }

  genCode() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LEN; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------------------------------

  /** Connected, non-departed human sessions of a room — its spectators included (room.state, match broadcasts). */
  *memberSessions(room) {
    for (const s of [...room.seats, ...room.spectators]) {
      if (!s || s.isBot || s.left) continue;
      const session = this.registry.byId(s.playerId);
      if (session && session.connected && session.roomCode === room.code) yield session;
    }
  }

  broadcastState(room) {
    this.directoryCache = null;
    if (room.disposed) return;
    const data = encode(room.toState());
    for (const session of this.memberSessions(room)) sendRaw(session.ws, data);
  }

  sendState(room, session) {
    sendSession(session, room.toState());
  }

  /** Match broadcast: encode once, send to every connected member. @returns {string | null} the encoded frame */
  broadcastRoom(room, msg) {
    if (room.disposed) return null;
    const data = encode(msg);
    if (data == null) { this.log.error(`[lobby] ${room.code} unserializable broadcast ${msg && msg.t}`); return null; }
    for (const session of this.memberSessions(room)) sendEncoded(session.ws, msg, data);
    return data;
  }

  /** Match unicast. @returns {boolean} */
  sendToPlayer(room, playerId, msg) {
    if (room.disposed) return false;
    const seat = room.seatOf(playerId) || room.spectatorOf(playerId);
    if (!seat || seat.isBot || seat.left) return false;
    const session = this.registry.byId(playerId);
    if (!session || session.roomCode !== room.code) return false;
    return sendSession(session, msg);
  }

  /** Only selected watchers receive these frames; never broadens the audience to the whole room. */
  sendBattleToPlayers(room, playerIds, msg) {
    if (room.disposed || (msg?.t !== 'b.snap' && msg?.t !== 'b.ev')) return 0;
    const recipients = new Set(playerIds), data = encode(msg);
    if (data == null) return 0;
    let sent = 0;
    for (const session of this.memberSessions(room)) {
      if (recipients.has(session.playerId) && sendRaw(session.ws, data, { droppable: isDroppable(msg) })) sent++;
    }
    return sent;
  }
}
