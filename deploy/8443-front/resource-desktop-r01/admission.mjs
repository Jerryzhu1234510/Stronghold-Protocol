import { createHmac, timingSafeEqual } from 'node:crypto';

// This is a resource-entry receipt, not an authentication credential.
// Account authorization remains entirely with the game server.
export class Admission {
  constructor({ secret, now = Date.now, secure = true, ttl = 12 * 3600000 } = {}) {
    if (!secret || Buffer.byteLength(secret) < 32) throw Error('Missing entry signing key');
    this.secret = secret; this.now = now; this.secure = secure; this.ttl = ttl;
    this.current = null; this.currentAt = 0; this.pending = null;
  }
  sign(value) { return createHmac('sha256', this.secret).update(value).digest('base64url'); }
  issue(build, digest, source) {
    const body = Buffer.from(JSON.stringify({ build, digest, source, exp: this.now() + this.ttl })).toString('base64url');
    const token = body + '.' + this.sign(body);
    return { token, cookie: 'sp_entry=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + Math.floor(this.ttl / 1000) + (this.secure ? '; Secure' : '') };
  }
  read(cookie = '') {
    try {
      const token = /(?:^|;\s*)sp_entry=([A-Za-z0-9_.-]{1,2048})(?:;|$)/.exec(cookie)?.[1];
      if (!token) return null;
      const [body, signature, extra] = token.split('.');
      if (extra || !signature) return null;
      const a = Buffer.from(signature), b = Buffer.from(this.sign(body));
      if (a.length !== b.length || !timingSafeEqual(a,b)) return null;
      const value = JSON.parse(Buffer.from(body,'base64url').toString());
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(value.build) || !/^[a-f0-9]{64}$/.test(value.digest) || !Number.isSafeInteger(value.exp) || value.exp <= this.now()) return null;
      return value;
    } catch { return null; }
  }
  async currentBuild(fetchBuild) {
    if (this.current && this.now() - this.currentAt < 2000) return this.current;
    if (!this.pending) this.pending = Promise.resolve().then(fetchBuild).then(build => {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(build || '')) throw Error('Invalid active build');
      this.current = build; this.currentAt = this.now(); return build;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  valid(cookie, build) { return this.read(cookie)?.build === build; }
}
