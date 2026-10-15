// Disabled in playable pools, not deleted from the reference data or asset manifests.
export const DISABLED_ENEMY_KEYS = Object.freeze(['enemy_1512_mcmstr']);
export const enemyEnabled = key => !DISABLED_ENEMY_KEYS.includes(key);
