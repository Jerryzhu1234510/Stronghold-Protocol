import { PHASE, ERR } from '../../../shared/constants.js';
import { OK, fail } from './common.js';
import { HeadlessJob } from '../fields.js';
import { t } from '../../../shared/i18n.js';

// Owner feedback 2026-10-09: an optional majority ballot ends a stuck unite battle.
export class MatchUniteVote {
  resetUniteVote() {
    this.cancel(this._uniteVoteTimer);
    this._uniteVoteTimer = null;
    this._uniteSkipping = false;
    this.uniteSkip = { used: false, vote: null };
  }

  uniteCanSkip() {
    return this.phase === PHASE.UNITE && this.fields.some(f => f.kind === 'unite' && f.live && !f.done) && !this._uniteSkipping;
  }

  requestUniteSkip(ps) {
    if (!this.uniteCanSkip()) return fail(ERR.WRONG_PHASE);
    if (!this.prepVoter(ps)) return fail(ERR.NOT_IN_ROOM);
    if (this.uniteSkip.used) return fail(ERR.BAD_TARGET, t('本次联防已发起过跳过投票'));
    const eligible = this.order.filter(p => this.prepVoter(p)).map(p => p.playerId);
    const vote = { id: `unite-${this.round}`, initiatorId: ps.playerId, eligible,
      required: Math.floor(eligible.length / 2) + 1, votes: { [ps.playerId]: true },
      deadline: this.sched.now() + 10000, status: 'pending' };
    this.uniteSkip = { used: true, vote };
    this._uniteVoteTimer = this.later(10000, () => this.finishUniteVote('expired'));
    this.evaluateUniteVote();
    this.markPublic();
    return OK;
  }

  castUniteVote(ps, voteId, agree) {
    const vote = this.uniteSkip?.vote;
    if (!this.uniteCanSkip() || vote?.status !== 'pending' || vote.id !== voteId) return fail(ERR.WRONG_PHASE);
    if (this.sched.now() >= vote.deadline) { this.finishUniteVote('expired'); return fail(ERR.WRONG_PHASE); }
    if (!this.prepVoter(ps) || !vote.eligible.includes(ps.playerId)) return fail(ERR.NOT_IN_ROOM);
    if (typeof agree !== 'boolean') return fail(ERR.BAD_MSG);
    if (Object.hasOwn(vote.votes, ps.playerId)) return fail(ERR.BAD_TARGET, t('已经投票，不能重复投票'));
    vote.votes[ps.playerId] = agree;
    this.evaluateUniteVote();
    this.markPublic();
    return OK;
  }

  evaluateUniteVote() {
    const vote = this.uniteSkip?.vote;
    if (vote?.status !== 'pending') return;
    const yes = Object.values(vote.votes).filter(Boolean).length;
    if (yes >= vote.required) this.finishUniteVote('passed');
    else if (yes + vote.eligible.length - Object.keys(vote.votes).length < vote.required) this.finishUniteVote('rejected');
  }

  finishUniteVote(status) {
    const vote = this.uniteSkip?.vote;
    if (vote?.status !== 'pending') return;
    this.cancel(this._uniteVoteTimer);
    this._uniteVoteTimer = null;
    if (!this.uniteCanSkip()) status = 'expired';
    vote.status = status;
    if (status === 'expired') for (const id of vote.eligible) if (!Object.hasOwn(vote.votes, id)) vote.votes[id] = false;
    this.markPublic();
    if (status === 'passed') this.skipUnite();
  }

  skipUnite() {
    if (!this.uniteCanSkip()) return;
    const f = this.fields.find(x => x.kind === 'unite');
    if (!f.cc) { this.runner.forceAll('timeout'); return; }
    // Replay only to the ballot's field clock, in bounded slices. Do not trust a client-supplied survivor count,
    // or use a headless run's future result: enemies killed AFTER the skip must still cost LP at this instant.
    const elapsed = this._fieldElapsed(f);
    this._stopClientCombat();
    this._uniteSkipping = true;
    f.mode = 'server';
    f.authority = null;
    f.result = null;
    for (const p of this._viewers()) this.sendTo(p.playerId, { t: 'b.end', battleId: f.battleId, fieldId: f.fieldId, reason: 'unite-skip' });
    const job = new HeadlessJob(this._specBattle(f.spec), { players: f.players,
      onError: e => this.reportError('unite skip replay', e) });
    job.cap = Math.min(job.cap, Math.floor((elapsed + 1e-8) / (job.battle.dt || 1 / 30)));
    f.job = job;
    const slice = () => {
      f.sliceTimer = null;
      if (this.phase !== PHASE.UNITE || f.job !== job || this.disposed || f.done) return;
      if (!job.run(this.headlessSliceMs)) { f.sliceTimer = this.later(0, slice); return; }
      f.job = null;
      const out = job.output();
      f.battle = out.battle;
      f.result = out.result;
      f.resultSource = 'server';
      f.timeline = out.timeline;
      f.endGt = Number(out.battle.time) || 0;
      this._uniteSkipping = false;
      this._fieldDone(f);
    };
    f.sliceTimer = this.later(0, slice);
  }
}
