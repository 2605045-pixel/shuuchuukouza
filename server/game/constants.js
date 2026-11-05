module.exports = {
  GRID_COLS: 15,
  GRID_ROWS: 13,
  TILE_SIZE: 48,

  TILE_TYPES: {
    EMPTY: 0,
    WALL: 1,  // 壊せない壁（外周・柱）
    BLOCK: 2, // 壊せるブロック
  },

  ITEM_TYPES: {
    FIRE: 'fire',     // 爆風範囲 +1
    BOMB: 'bomb',     // 設置爆弾数 +1
    SPEED: 'speed',   // 移動速度 +0.5
    KICK: 'kick',     // 爆弾キック能力
    REVIVE: 'revive', // 仲間復活能力 (1回使い切り)
  },

  GAME_MODES: {
    FFA: 'ffa',             // 個人戦 (最大8人)
    TEAM_2V2: 'team2v2',     // チーム戦 2v2 (4人)
    TEAM_3V3: 'team3v3',     // チーム戦 3v3 (6人)
  },

  TEAMS: {
    BLUE: 'blue',
    RED: 'red',
  },

  TEAM_CONFIG: {
    blue: {
      name: 'Team Blue',
      color: '#3b82f6',
      accent: '#60a5fa',
      spawns: [
        { x: 1, y: 1 },   // 左上
        { x: 1, y: 11 },  // 左下
        { x: 1, y: 5 },   // 左中
      ],
    },
    red: {
      name: 'Team Red',
      color: '#ef4444',
      accent: '#f87171',
      spawns: [
        { x: 13, y: 11 }, // 右下
        { x: 13, y: 1 },  // 右上
        { x: 13, y: 7 },  // 右中
      ],
    },
  },

  MAP_THEMES: ['cyber', 'ruins', 'magma'],

  // プレイヤー初期設定
  PLAYER_DEFAULTS: {
    BASE_SPEED: 3.2,
    MAX_SPEED: 6.0,
    SPEED_INC: 0.6,
    BASE_BOMBS: 1,
    MAX_BOMBS: 8,
    BASE_RANGE: 1,
    MAX_RANGE: 8,
    CAN_KICK: false,
    HITBOX_RADIUS: 18,
    INVULNERABLE_DURATION: 3000, // 復活時の無敵時間(ms)
  },

  // 爆弾・爆発設定
  BOMB: {
    FUSE_TIME: 3000,     // 爆発までの時間(ms)
    EXPLOSION_TIME: 600, // 爆風が消えるまでの時間(ms)
    KICK_SPEED: 7.0,     // キックされた時の滑る速度(px/frame)
    SIZE: 38,
  },

  // FFA スポーン可能座標 (最大8人対応)
  SPAWN_POINTS: [
    { x: 1, y: 1, color: '#3b82f6', name: 'Blue' },     // 左上
    { x: 13, y: 11, color: '#ef4444', name: 'Red' },   // 右下
    { x: 13, y: 1, color: '#10b981', name: 'Green' },   // 右上
    { x: 1, y: 11, color: '#f59e0b', name: 'Yellow' },  // 左下
    { x: 7, y: 1, color: '#8b5cf6', name: 'Purple' },   // 上中央
    { x: 7, y: 11, color: '#ec4899', name: 'Pink' },    // 下中央
    { x: 1, y: 5, color: '#06b6d4', name: 'Cyan' },     // 左中
    { x: 13, y: 7, color: '#f97316', name: 'Orange' },  // 右中
  ],

  PHYSICS_TICK_RATE: 60,  // サーバー物理シミュレーション (60Hz)
  BROADCAST_RATE: 30,     // ネットワーク配信レート (30Hzで大幅に負荷軽減)
};
