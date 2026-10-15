// Room discovery exposes only public room summaries, never membership tokens or chat history.
import { sanitizeChat } from './chat.js';
import { t } from './i18n.js';

export const RECRUIT_INTERVAL_MS = 10_000;
export const RECRUIT_MAX_LEN = 120;
export const validVisibility = (v) => v === 'public' || v === 'private';
export const validMapVersion = (v) => v === 'classic' || v === 'new' || v === 'official';
export const mapName = (v) => v === 'official' ? t('官方场景（0.2.5）') : v === 'classic' ? '0.1.4 经典棋盘' : '新版简约棋盘';
// The reference's classic board uses the extracted materials and three.js scene;
// the current simplified board keeps the procedural Pixi tiles.
export const boardAppearance = (v) => v === 'official' ? { board: '3d', boardArt: true, officialScenes: true }
  : v === 'classic' ? { board: '3d', boardArt: true, officialScenes: false } : { board: '2d', boardArt: false, officialScenes: false };
export function validRecruitment(text) {
  return typeof text === 'string' && text.length <= RECRUIT_MAX_LEN * 2
    && [...text].length <= RECRUIT_MAX_LEN && sanitizeChat(text).length > 0;
}
