import { html, Button, Modal } from './components.js';
import { createStore, useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';
export const releaseNotesStore = createStore({ open: false });
export const openReleaseNotes = () => releaseNotesStore.set({ open: true });
export const closeReleaseNotes = () => releaseNotesStore.set({ open: false });
export function installReleaseNotes() { openReleaseNotes(); }
export function supportReleaseRows(catalog, bonds) {
  return Object.values(catalog || {}).filter(op => op.ready).map(op => ({
    id: op.charId, name: op.name, bonds: (op.bonds || []).map(id => bonds?.[id]?.name || id).join('、'),
  }));
}
export function ReleaseNotesButton({ size = 'sm', class: cls }) {
  return html`<span class="release-notes-entry">
    <${Button} variant="secondary" size=${size} class=${cls} onClick=${openReleaseNotes}>${t('更新公告')}<//>
    <span class="release-notes-entry__feedback">${t('问题反馈群：')}<strong>1127927007</strong> / ${t('455814975（已满）')}</span>
  </span>`;
}
export function ReleaseNotesHost() {
  const open = useStore(s => s.open, Object.is, releaseNotesStore);
  return html`<${Modal} open=${open} title=${t('更新公告')} micro=${t('v0.3.0 · 8443本地兼容候选版')}
    class="release-notes" width="min(820px, 94vw)" onClose=${closeReleaseNotes}
    actions=${html`<${Button} variant="primary" onClick=${closeReleaseNotes}>${t('我知道了')}<//>`}>
    <div class="release-notes__content">
      <div class="release-notes__callout release-notes__launch">
        <strong>${t('本地验收中，尚未更新正式服务器')}</strong>
        <p>${t('以官方0.3.0为基础。战斗规则、干员、策略、皮肤语音、特效、场景和素材导入优先使用官方实现。')}</p>
      </div>
      <p>${t('保留账号、好友邀请和申请入房、观战、历史、累计杯数、4～8人房间、克隆模式和房间扩展。房间扩展默认关闭；本地外观与音乐Mod不改变联机规则。')}</p>
      <p>${t('终极正常4～8人通关8杯；仅提高Boss或其他敌人生命不降杯。克隆、个人卡池、取消Boss限伤或鸭爵加强减半一次。训练不计杯。')}</p>
      <p>${t('旧资源包继续复用，不用清空；0.3.0新增素材需要补充。8443关闭服务器素材预下载，缺失文件提示补导，不自动重复下载。')}</p>
      <p>${t('本地Mod继续支持音乐、外观和小人动作；官方插件管理采用官方界面。当前测试入口未开放联网玩法插件。')}</p>
      <p>${t('新版客户端和资源补全包以服主实际发布的文件为准。当前页面不代表已上传群文件或网盘。')}</p>
      <p class="release-notes__feedback"><strong>${t('问题反馈群：')}1127927007</strong><span>${t('455814975（已满）')}</span></p>
    </div>
  <//>`;
}
