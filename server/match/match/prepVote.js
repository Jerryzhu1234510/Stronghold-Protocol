import { PHASE, ERR } from '../../../shared/constants.js';
import { OK, fail } from './common.js';

// Votes use a fixed electorate: reconnects retain their ballot, disconnects cannot lower the quorum.
export class MatchPrepVote {
  resetPrepVote() {
    this.cancel(this._prepVoteTimer);
    this.cancel(this._prepReminderTimer);
    this._prepVoteTimer = this._prepReminderTimer = null;
    this.prepExtension = { enabled: !this.soloUntimed && this.deadline > 0, used: false, addedSeconds: 0, vote: null, reminder: null };
  }

  prepVoter(ps) {
    return ps && !ps.isBot && !ps.spectator && !ps.left && ps.alive && ps.connected;
  }

  requestPrepExtension(ps, seconds) {
    if (this.phase !== PHASE.PREP || !this.prepExtension?.enabled || this.sched.now() >= this.deadline) return fail(ERR.WRONG_PHASE);
    if (!this.prepVoter(ps)) return fail(ERR.NOT_IN_ROOM);
    if (seconds !== 30 && seconds !== 60) return fail(ERR.BAD_MSG);
    if (ps.ready) return fail(ERR.BAD_TARGET, '请先取消准备，再发起加时');
    const ext = this.prepExtension;
    if (ext.used) return fail(ERR.BAD_TARGET, '本回合已发起过加时投票');
    const eligible = this.order.filter(p => this.prepVoter(p)).map(p => p.playerId);
    const id = `prep-${this.round}-${++this._prepVoteSeq}`;
    const deadline = Math.min(this.deadline, this.sched.now() + this.scaled(30000));
    ext.used = true;
    ext.vote = { id, seconds, initiatorId: ps.playerId, eligible, required: Math.floor(eligible.length / 2) + 1,
      votes: { [ps.playerId]: true }, deadline, status: 'pending' };
    this._prepVoteTimer = this.later(Math.max(0, deadline - this.sched.now()), () => this.finishPrepVote('expired'));
    this.evaluatePrepVote();
    this.markPublic();
    return OK;
  }

  castPrepVote(ps, voteId, agree) {
    const vote = this.prepExtension?.vote;
    if (this.phase !== PHASE.PREP || !vote || vote.status !== 'pending' || vote.id !== voteId) return fail(ERR.WRONG_PHASE);
    // Do not accept a packet queued before a deadline after that deadline has passed.
    if (this.sched.now() >= vote.deadline || this.sched.now() >= this.deadline) {
      this.finishPrepVote('expired');
      return fail(ERR.WRONG_PHASE);
    }
    if (!this.prepVoter(ps) || !vote.eligible.includes(ps.playerId)) return fail(ERR.NOT_IN_ROOM);
    if (typeof agree !== 'boolean') return fail(ERR.BAD_MSG);
    if (Object.hasOwn(vote.votes, ps.playerId)) return fail(ERR.BAD_TARGET, '已经投票，不能重复投票');
    vote.votes[ps.playerId] = agree;
    this.evaluatePrepVote();
    this.markPublic();
    return OK;
  }

  evaluatePrepVote() {
    const vote = this.prepExtension?.vote;
    if (!vote || vote.status !== 'pending') return;
    const yes = Object.values(vote.votes).filter(Boolean).length;
    const answered = Object.keys(vote.votes).length;
    if (yes >= vote.required) this.finishPrepVote('passed');
    else if (yes + vote.eligible.length - answered < vote.required) this.finishPrepVote('rejected');
  }

  finishPrepVote(status) {
    const ext = this.prepExtension;
    const vote = ext?.vote;
    if (!vote || vote.status !== 'pending') return;
    this.cancel(this._prepVoteTimer);
    this._prepVoteTimer = null;
    // A completed phase always wins, including an all-ready/deadline race.
    if (status === 'passed' && (this.phase !== PHASE.PREP || this.sched.now() >= this.deadline)) status = 'expired';
    vote.status = status;
    if (status === 'expired') for (const id of vote.eligible) if (!Object.hasOwn(vote.votes, id)) vote.votes[id] = false;
    if (status === 'passed') {
      ext.addedSeconds = vote.seconds;
      const deadline = this.deadline + this.scaled(vote.seconds * 1000);
      this.cancel(this._phaseTimer);
      this.deadline = deadline;
      this._phaseTimer = this.later(Math.max(0, deadline - this.sched.now()), () => {
        this._phaseTimer = null;
        this.prepDeadline();
      });
    }
    this.markPublic();
  }

  readyReminder(ps) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!this.prepVoter(ps)) return fail(ERR.NOT_IN_ROOM);
    const ext = this.prepExtension;
    if (!ext) return fail(ERR.WRONG_PHASE);
    if (ext.reminder && this.sched.now() < ext.reminder.until) return fail(ERR.RATE, '准备提醒每 5 秒可发送一次');
    ext.reminder = { playerId: ps.playerId, until: this.sched.now() + this.scaled(5000) };
    this.cancel(this._prepReminderTimer);
    this._prepReminderTimer = this.later(this.scaled(5000), () => {
      this._prepReminderTimer = null;
      if (this.phase === PHASE.PREP && this.prepExtension === ext) { ext.reminder = null; this.markPublic(); }
    });
    this.markPublic();
    return OK;
  }
}
