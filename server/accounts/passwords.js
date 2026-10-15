// server/accounts/passwords.js — 密码哈希：PBKDF2-SHA256，随机 16 字节盐、32 字节密钥，**参数一起存**。
// (i18n-ignore-file: 这个文件里的中文是**给运维看的** —— 启动日志、管理接口的备份校验报告；错误响应给客户端的是稳定的 code（`{ error: 'CODE' }`），文案由客户端从 public/i18n 取。玩家可见的账号文案在第 6 轮做 UI 时走客户端 i18n。)
//
// 移植自 fork 的 `worker/accounts/passwords.js`，算法与参数刻意保持一致（同样 100,000 次迭代、同样的
// `{ alg, iterations, salt, hash }` base64url 形式），这样 fork 的备份能直接导进来、反过来也行。参数一起存是为了
// 以后能换参数：用旧参数登录成功后，会按新参数重新存一遍。
//
// 与 fork 的两点差别：
//   · 用 Node 的 WebCrypto（`globalThis.crypto.subtle`，Node 18+ 原生提供），而不是 Cloudflare 的 crypto —— 接口相同，
//     所以哈希结果与 fork 完全一致；
//   · **迭代次数可调**：fork 被 Workers 的 100,000 上限钉住，自建服务器没有这个限制。默认仍是 100,000（与 fork
//     兼容），要更强可以调高 —— 代价是每次登录多花 CPU。

const ALG = 'pbkdf2-sha256';
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/**
 * PBKDF2 迭代次数。
 * 默认 100,000：与 fork 相同，所以两边的哈希可以互相校验、备份可以互换。
 * 自建服务器可以调高（Workers 的上限不适用于这里），调高后**旧哈希照样能登录**（参数存在哈希里），登录成功时
 * 会按新参数重新存一遍 —— 所以这是一个可以随时上调、不用洗数据的旋钮。
 */
export const PBKDF2_ITERATIONS = Number(process.env.SP_PBKDF2_ITERATIONS) > 0
  ? Math.max(10_000, Math.floor(Number(process.env.SP_PBKDF2_ITERATIONS)))
  : 100_000;

const subtle = () => globalThis.crypto?.subtle;

// base64url：与 fork 同一套（`+`→`-`、`/`→`_`、去掉 `=`），所以盐和哈希的字符串形式一致。
const toBase64Url = (bytes) => Buffer.from(bytes).toString('base64')
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const fromBase64Url = (text) => new Uint8Array(Buffer.from(String(text).replaceAll('-', '+').replaceAll('_', '/'), 'base64'));

const PEPPER = () => String(process.env.SP_PASSWORD_PEPPER || '');

async function derive(password, salt, iterations) {
  const enc = new TextEncoder();
  // 一个可选的服务器端 pepper：不在库里，只有服务器知道 —— 库被拿走也挡一层。默认空（pepper 为空时行为与 fork 一致）。
  const material = PEPPER() ? `${password}\u0000${PEPPER()}` : password;
  const key = await subtle().importKey('raw', enc.encode(material), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, KEY_BYTES * 8);
  return new Uint8Array(bits);
}

/**
 * 用指定参数推导（**测试用**）：造一个「旧参数存的哈希」，验证登录时会按当前参数重存。
 * 生产路径请用 hashPassword / verifyPassword。
 */
export const deriveForTest = (password, saltB64, iterations) => derive(password, fromBase64Url(saltB64), iterations);

/** 一个新密码的存储形式。 */
export async function hashPassword(password) {
  const salt = new Uint8Array(SALT_BYTES);
  globalThis.crypto.getRandomValues(salt);
  const iterations = PBKDF2_ITERATIONS;
  const hash = await derive(password, salt, iterations);
  return { alg: ALG, iterations, salt: toBase64Url(salt), hash: toBase64Url(hash) };
}

/**
 * 用户名不存在时拿什么去比：**同样的推导**，所以「用户名不存在」与「密码错误」耗时一样，
 * 从响应时间上分辨不出一个用户名是否注册过。
 */
const NOBODY = Object.freeze({
  alg: ALG, iterations: PBKDF2_ITERATIONS,
  salt: 'c3Ryb25naG9sZC1kdW1teQ', hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
});

/** 定长比较，避免按字节提前返回泄露信息。 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * 校验一个密码。
 * @param {object|null} stored 库里存的 `{ alg, iterations, salt, hash }`；账号不存在时传 null
 * @returns {Promise<{ ok: boolean, rehash: object|null }>} `rehash` 非空表示参数已变，调用方应把它存回去
 */
export async function verifyPassword(stored, password) {
  const rec = stored && stored.alg === ALG ? stored : NOBODY;
  let salt;
  let expected;
  try {
    salt = fromBase64Url(rec.salt);
    expected = fromBase64Url(rec.hash);
  } catch {
    salt = fromBase64Url(NOBODY.salt);
    expected = fromBase64Url(NOBODY.hash);
  }
  const iterations = Number.isInteger(rec.iterations) && rec.iterations > 0 ? rec.iterations : PBKDF2_ITERATIONS;
  const actual = await derive(password, salt, iterations);
  const ok = !!stored && stored.alg === ALG && timingSafeEqual(actual, expected);
  // 参数变了（迭代次数上调、或换了 pepper）⇒ 登录成功后按当前参数重存一次，玩家无感
  const rehash = ok && (stored.iterations !== PBKDF2_ITERATIONS || stored.alg !== ALG) ? await hashPassword(password) : null;
  return { ok, rehash };
}

/** 这个存储形式是不是本模块认的（导入备份时校验用）。 */
export const looksLikeHash = (h) => !!h && typeof h === 'object' && typeof h.alg === 'string'
  && typeof h.salt === 'string' && typeof h.hash === 'string';
