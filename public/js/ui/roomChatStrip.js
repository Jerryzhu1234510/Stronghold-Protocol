import { html } from './components.js';
import { useStore } from '../store.js';
import { RoomChat } from './roomChat.js';

/** Lobby and combat share the compact panel, draft handling and room history. */
export function RoomChatStrip() {
  const code = useStore(s => s.room?.code);
  return html`<${RoomChat} key=${code} code=${code}/>`;
}
