import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { boardAppearance } from '../shared/roomDirectory.js';

// Real match classes: the room-only stub cannot catch appearance reset during match construction.
for (const gameMode of ['normal', 'clone', 'versus']) {
  for (const mapVersion of ['classic', 'new', 'official']) {
    test(`${gameMode}: selected ${mapVersion} appearance survives actual room start and public broadcast`, async () => {
      const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, seedFn: () => 81 });
      const client = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
      try {
        const { playerId } = await client.hello('外观验收');
        const ok = async (t, values = {}) => {
          const reply = await client.request({ t, ...values });
          assert.equal(reply.t, 'ok', JSON.stringify(reply));
        };
        await ok('room.create', { mode: 'coop', difficulty: 'NORMAL', capacity: 4, gameMode,
          visibility: 'private', description: '棋盘外观实际开局验收' });
        assert.equal(server.lobby.roomOf(server.registry.byId(playerId)).mapVersion, 'official');
        await ok('room.setMapVersion', { mapVersion });
        for (let seat = 1; seat < 4; seat++) await ok('room.addBot');
        await ok('room.start');
        const room = server.lobby.roomOf(server.registry.byId(playerId));
        const publicState = await client.waitFor('m.public');
        assert.ok(room.match);
        assert.equal(room.toState().mapVersion, mapVersion);
        assert.equal(room.match.publicView().mapVersion, mapVersion);
        assert.equal(publicState.mapVersion, mapVersion);
        assert.equal(boardAppearance(publicState.mapVersion).officialScenes, mapVersion === 'official');
      } finally {
        await client.terminate();
        await server.close();
      }
    });
  }
}
