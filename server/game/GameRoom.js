const {
  GRID_COLS,
  GRID_ROWS,
  TILE_SIZE,
  SPAWN_POINTS,
  BOMB,
  GAME_MODES,
  TEAMS,
  TEAM_CONFIG,
  MAP_THEMES,
  PLAYER_DEFAULTS,
  PHYSICS_TICK_RATE,
  BROADCAST_RATE,
} = require('./constants');
const GameMap = require('./GameMap');
const Player = require('./Player');
const Bomb = require('./Bomb');

class GameRoom {
  constructor(roomId, io) {
    this.roomId = roomId;
    this.io = io;

    this.gameMode = GAME_MODES.TEAM_2V2; // デフォルトはチーム戦(2v2)
    this.mapTheme = 'cyber';             // 'cyber' | 'ruins' | 'magma'
    this.teamScores = { blue: 0, red: 0 };

    this.map = new GameMap(this.mapTheme);
    this.players = new Map(); // socketId => Player
    this.playerInputs = new Map(); // socketId => { up, down, left, right }
    this.bombs = new Map(); // bombId => Bomb
    this.nextBombId = 1;
    this.explosions = []; // { id, cells: [{col, row}], createdAt, duration }
    this.nextExplosionId = 1;

    this.state = 'LOBBY'; // 'LOBBY' | 'PLAYING' | 'GAMEOVER'
    this.winner = null;
    this.winnerTeam = null;
    this.hostSocketId = null;

    // マップ変更投票ステート
    this.currentMapVote = null;

    // パフォーマンス最適化用タイマーとダーティトラッキング
    this.intervalId = null;
    this.lastBroadcastTime = 0;
    this.lastBroadcastGridVersion = 0;

    this.startLoop();
  }

  startLoop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      this.tick();
    }, 1000 / PHYSICS_TICK_RATE);
  }

  stopLoop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.currentMapVote && this.currentMapVote.timeoutId) {
      clearTimeout(this.currentMapVote.timeoutId);
      this.currentMapVote = null;
    }
  }

  setGameMode(mode) {
    if (!Object.values(GAME_MODES).includes(mode)) return;
    this.gameMode = mode;

    // FFAへ切り替え時はチームを解除
    if (mode === GAME_MODES.FFA) {
      for (const player of this.players.values()) {
        player.team = null;
        const sp = SPAWN_POINTS[player.spawnIndex % SPAWN_POINTS.length];
        player.color = sp.color;
      }
    } else {
      // チーム戦モードへの切り替え時は定員オーバーがあれば調整
      const maxPerTeam = mode === GAME_MODES.TEAM_2V2 ? 2 : 3;
      const bluePlayers = [...this.players.values()].filter(p => p.team === TEAMS.BLUE);
      const redPlayers = [...this.players.values()].filter(p => p.team === TEAMS.RED);
      if (bluePlayers.length > maxPerTeam) {
        bluePlayers.slice(maxPerTeam).forEach(p => p.team = null);
      }
      if (redPlayers.length > maxPerTeam) {
        redPlayers.slice(maxPerTeam).forEach(p => p.team = null);
      }
    }

    this.broadcastLobbyState();
  }

  setMapTheme(theme) {
    if (!MAP_THEMES.includes(theme)) return;
    this.mapTheme = theme;
    this.broadcastLobbyState();
  }

  setPlayerTeam(socketId, team) {
    const player = this.players.get(socketId);
    if (!player || this.gameMode === GAME_MODES.FFA) return;
    if (team !== TEAMS.BLUE && team !== TEAMS.RED) return;

    const maxPerTeam = this.gameMode === GAME_MODES.TEAM_2V2 ? 2 : 3;
    const currentInTeam = [...this.players.values()].filter(p => p.team === team && p.id !== socketId).length;

    if (currentInTeam >= maxPerTeam) {
      return { success: false, message: `チーム ${team.toUpperCase()} は満員です (最大${maxPerTeam}人)` };
    }

    player.team = team;
    this.updatePlayerTeamColor(player);
    this.broadcastLobbyState();
    return { success: true };
  }

  updatePlayerTeamColor(player) {
    if (!player.team) return;
    const sameTeamPlayers = [...this.players.values()].filter(p => p.team === player.team);
    const indexInTeam = Math.max(0, sameTeamPlayers.findIndex(p => p.id === player.id));

    if (player.team === TEAMS.BLUE) {
      const blueShades = ['#3b82f6', '#2563eb', '#06b6d4'];
      player.color = blueShades[indexInTeam % blueShades.length];
    } else {
      const redShades = ['#ef4444', '#dc2626', '#f97316'];
      player.color = redShades[indexInTeam % redShades.length];
    }
  }

  autoAssignTeams() {
    if (this.gameMode === GAME_MODES.FFA) return;

    const maxPerTeam = this.gameMode === GAME_MODES.TEAM_2V2 ? 2 : 3;
    const blueList = [];
    const redList = [];
    const unassigned = [];

    for (const player of this.players.values()) {
      if (player.team === TEAMS.BLUE) blueList.push(player);
      else if (player.team === TEAMS.RED) redList.push(player);
      else unassigned.push(player);
    }

    for (const player of unassigned) {
      if (blueList.length < maxPerTeam && (blueList.length <= redList.length || redList.length >= maxPerTeam)) {
        player.team = TEAMS.BLUE;
        blueList.push(player);
      } else if (redList.length < maxPerTeam) {
        player.team = TEAMS.RED;
        redList.push(player);
      } else {
        // 余ったプレイヤーはとりあえずどちらかへ
        player.team = blueList.length <= redList.length ? TEAMS.BLUE : TEAMS.RED;
      }
    }

    for (const player of this.players.values()) {
      this.updatePlayerTeamColor(player);
    }
  }

  addPlayer(socketId, name) {
    const usedIndices = new Set([...this.players.values()].map(p => p.spawnIndex));
    let slotIndex = -1;
    for (let i = 0; i < SPAWN_POINTS.length; i++) {
      if (!usedIndices.has(i)) {
        slotIndex = i;
        break;
      }
    }
    if (slotIndex === -1) {
      slotIndex = this.players.size % SPAWN_POINTS.length;
    }

    const sp = SPAWN_POINTS[slotIndex];
    const playerName = (name && name.trim().length > 0) ? name.trim().slice(0, 12) : `Player ${slotIndex + 1}`;
    const player = new Player(socketId, playerName, sp.color, sp.x, sp.y, slotIndex);

    // チーム戦モードの場合はロビーで自由にチーム選択できるよう、初期は未所属とし、開始時または選択時に確定
    if (this.gameMode !== GAME_MODES.FFA) {
      player.team = null;
    }

    this.players.set(socketId, player);
    this.playerInputs.set(socketId, { up: false, down: false, left: false, right: false });

    if (!this.hostSocketId) {
      this.hostSocketId = socketId;
    }

    this.broadcastLobbyState();
    return player;
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return;

    this.players.delete(socketId);
    this.playerInputs.delete(socketId);

    if (this.hostSocketId === socketId) {
      const remainingIds = [...this.players.keys()];
      this.hostSocketId = remainingIds.length > 0 ? remainingIds[0] : null;
    }

    if (this.state === 'PLAYING') {
      this.checkGameEnd();
    }

    if (this.currentMapVote) {
      this.checkMapVoteResult();
    }

    this.broadcastLobbyState();
  }

  handleInput(socketId, input) {
    if (this.playerInputs.has(socketId)) {
      this.playerInputs.set(socketId, {
        up: !!input.up,
        down: !!input.down,
        left: !!input.left,
        right: !!input.right,
      });
    }
  }

  startGame(socketId) {
    if (this.hostSocketId !== socketId && this.players.size > 1) {
      return { success: false, message: 'ホストのみがゲームを開始できます' };
    }

    // チーム戦モードの検証とスポーン設定
    if (this.gameMode !== GAME_MODES.FFA) {
      this.autoAssignTeams();

      const bluePlayers = [...this.players.values()].filter(p => p.team === TEAMS.BLUE);
      const redPlayers = [...this.players.values()].filter(p => p.team === TEAMS.RED);

      if (this.players.size >= 2 && (bluePlayers.length === 0 || redPlayers.length === 0)) {
        return { success: false, message: '各チームに最低1人以上のプレイヤーが必要です' };
      }

      // チームごとのスポーン位置を適用
      bluePlayers.forEach((p, idx) => {
        const spawn = TEAM_CONFIG.blue.spawns[idx % TEAM_CONFIG.blue.spawns.length];
        p.spawnCol = spawn.x;
        p.spawnRow = spawn.y;
        this.updatePlayerTeamColor(p);
      });

      redPlayers.forEach((p, idx) => {
        const spawn = TEAM_CONFIG.red.spawns[idx % TEAM_CONFIG.red.spawns.length];
        p.spawnCol = spawn.x;
        p.spawnRow = spawn.y;
        this.updatePlayerTeamColor(p);
      });
    } else {
      // FFAモードのスポーン設定
      let idx = 0;
      for (const player of this.players.values()) {
        const sp = SPAWN_POINTS[idx % SPAWN_POINTS.length];
        player.spawnCol = sp.x;
        player.spawnRow = sp.y;
        player.color = sp.color;
        idx++;
      }
    }

    this.map.generate(this.mapTheme);
    this.bombs.clear();
    this.explosions = [];
    this.winner = null;
    this.winnerTeam = null;

    // 全プレイヤー初期化
    for (const player of this.players.values()) {
      player.resetRound();
    }

    this.state = 'PLAYING';
    this.lastBroadcastGridVersion = 0; // 強制的に初期グリッドを配信させる

    this.io.to(this.roomId).emit('game_started', {
      gameMode: this.gameMode,
      mapTheme: this.mapTheme,
      teamScores: this.teamScores,
      grid: this.map.grid,
      gridVersion: this.map.gridVersion,
    });

    return { success: true };
  }

  restartGame(socketId) {
    return this.startGame(socketId);
  }

  // プレイヤー降参 (Give Up)
  giveUp(socketId) {
    if (this.state !== 'PLAYING') return { success: false, message: 'ゲーム中ではありません' };
    const player = this.players.get(socketId);
    if (!player || !player.alive) return { success: false, message: '既に倒れているか無効なプレイヤーです' };

    player.alive = false;
    const tile = player.getTile();
    this.io.to(this.roomId).emit('sound_event', { type: 'player_death', col: tile.col, row: tile.row });
    this.io.to(this.roomId).emit('player_eliminated', {
      playerId: player.id,
      name: player.name,
      team: player.team,
      reason: 'give_up',
    });
    this.io.to(this.roomId).emit('toast_message', `🏳️ ${player.name} が降参しました`);
    this.checkGameEnd();
    return { success: true };
  }

  // マップ変更投票の開始
  startMapVote(socketId, targetTheme) {
    if (!MAP_THEMES.includes(targetTheme)) {
      return { success: false, message: '無効なマップテーマです' };
    }
    const player = this.players.get(socketId);
    if (!player) return { success: false, message: '無効なプレイヤーです' };

    if (this.currentMapVote) {
      return { success: false, message: '現在別のマップ投票が進行中です' };
    }

    const themeNames = {
      cyber: '⚡ サイバー・マトリクス (Cyber Matrix)',
      ruins: '🌿 古代エメラルド洞窟 (Emerald Cavern)',
      magma: '🌋 ヴォルカニック・マグマ (Volcanic Lava)',
    };
    const targetThemeName = themeNames[targetTheme] || targetTheme;

    // ソロプレイ（1人）の場合は即時可決＆マップ変更再スタート
    if (this.players.size <= 1) {
      this.mapTheme = targetTheme;
      this.io.to(this.roomId).emit('map_vote_passed', {
        targetTheme,
        targetThemeName,
        proposerName: player.name,
        instant: true,
      });
      this.io.to(this.roomId).emit('toast_message', `🗺️ マップを「${targetThemeName}」に変更しました`);
      this.restartGame(socketId);
      return { success: true, instant: true };
    }

    const vote = {
      proposerId: socketId,
      proposerName: player.name,
      targetTheme,
      targetThemeName,
      votes: new Map([[socketId, true]]), // 提案者は自動で「賛成」
      expiresAt: Date.now() + 15000,
      timeoutId: null,
    };

    vote.timeoutId = setTimeout(() => {
      if (this.currentMapVote === vote) {
        this.resolveMapVote(false, 'timeout');
      }
    }, 15000);

    this.currentMapVote = vote;
    this.broadcastMapVoteState();
    this.checkMapVoteResult(); // 2人対戦で過半数チェック（初期1票）
    return { success: true };
  }

  // マップ変更投票の投票
  castMapVote(socketId, agree) {
    if (!this.currentMapVote) return { success: false, message: '現在進行中の投票はありません' };
    if (!this.players.has(socketId)) return { success: false, message: '無効なプレイヤーです' };

    this.currentMapVote.votes.set(socketId, !!agree);
    this.checkMapVoteResult();
    return { success: true };
  }

  // 投票結果の判定
  checkMapVoteResult() {
    if (!this.currentMapVote) return;
    const vote = this.currentMapVote;
    const total = this.players.size;
    let yes = 0;
    let no = 0;

    for (const [id, val] of vote.votes.entries()) {
      if (this.players.has(id)) {
        if (val) yes++;
        else no++;
      }
    }

    const requiredYes = Math.floor(total / 2) + 1;
    const maxPossibleYes = total - no;

    if (yes >= requiredYes) {
      this.resolveMapVote(true);
    } else if (maxPossibleYes < requiredYes) {
      this.resolveMapVote(false, 'rejected');
    } else {
      this.broadcastMapVoteState();
    }
  }

  // 投票の決着処理
  resolveMapVote(passed, reason = '') {
    if (!this.currentMapVote) return;
    const vote = this.currentMapVote;
    if (vote.timeoutId) clearTimeout(vote.timeoutId);
    this.currentMapVote = null;

    if (passed) {
      this.mapTheme = vote.targetTheme;
      this.io.to(this.roomId).emit('map_vote_passed', {
        targetTheme: vote.targetTheme,
        targetThemeName: vote.targetThemeName,
        proposerName: vote.proposerName,
      });
      this.io.to(this.roomId).emit('toast_message', `🗺️ マップ変更可決！「${vote.targetThemeName}」で開始します`);
      this.restartGame(this.hostSocketId || vote.proposerId);
    } else {
      this.io.to(this.roomId).emit('map_vote_failed', {
        targetTheme: vote.targetTheme,
        targetThemeName: vote.targetThemeName,
        proposerName: vote.proposerName,
        reason,
      });
      const reasonMsg = reason === 'timeout' ? '時間切れのため否決されました' : '反対多数のため否決されました';
      this.io.to(this.roomId).emit('toast_message', `❌ マップ変更は${reasonMsg}`);
    }
  }

  // 投票状況の全配信
  broadcastMapVoteState() {
    if (!this.currentMapVote) return;
    const vote = this.currentMapVote;
    const total = this.players.size;
    let yes = 0;
    let no = 0;

    for (const [id, val] of vote.votes.entries()) {
      if (this.players.has(id)) {
        if (val) yes++;
        else no++;
      }
    }

    const remainingMs = Math.max(0, vote.expiresAt - Date.now());

    this.io.to(this.roomId).emit('map_vote_state', {
      proposerName: vote.proposerName,
      targetTheme: vote.targetTheme,
      targetThemeName: vote.targetThemeName,
      yesCount: yes,
      noCount: no,
      requiredYes: Math.floor(total / 2) + 1,
      totalPlayers: total,
      remainingSeconds: Math.ceil(remainingMs / 1000),
    });
  }

  // 爆弾設置
  placeBomb(socketId) {
    if (this.state !== 'PLAYING') return;
    const player = this.players.get(socketId);
    if (!player || !player.canPlaceBomb()) return;

    const tile = player.getTile();
    const existingBomb = this.getBombAt(tile.col, tile.row);
    if (existingBomb) return;
    if (this.map.isSolid(tile.col, tile.row)) return;

    const bombId = this.nextBombId++;
    const bomb = new Bomb(bombId, player.id, tile.col, tile.row, player.bombRange);
    this.bombs.set(bombId, bomb);

    player.activeBombs++;
    player.bombsInside.add(bombId);

    this.io.to(this.roomId).emit('sound_event', { type: 'bomb_drop', col: tile.col, row: tile.row });
  }

  getBombAt(col, row) {
    for (const bomb of this.bombs.values()) {
      if (bomb.col === col && bomb.row === row) {
        return bomb;
      }
    }
    return null;
  }

  // キック等の障害物判定関数
  isBlockedForBomb(col, row, ignoreBombId) {
    if (this.map.isSolid(col, row)) return true;

    for (const bomb of this.bombs.values()) {
      if (bomb.id !== ignoreBombId && bomb.col === col && bomb.row === row) {
        return true;
      }
    }

    for (const player of this.players.values()) {
      if (player.alive) {
        const pt = player.getTile();
        if (pt.col === col && pt.row === row) {
          return true;
        }
      }
    }

    return false;
  }

  // 味方復活（蘇生）パワー発動 (1回使い切り)
  reviveTeammate(socketId) {
    if (this.state !== 'PLAYING') return { success: false, message: 'ゲーム中ではありません' };
    const player = this.players.get(socketId);
    if (!player || !player.alive) return { success: false, message: '生存プレイヤーのみ使用できます' };
    if (!player.hasRevive) return { success: false, message: '復活パワーを所持していません' };

    // チーム戦モードの場合: 同じチームの死亡した仲間を探す
    if (this.gameMode !== GAME_MODES.FFA) {
      const deadTeammates = [...this.players.values()].filter(p => p.team === player.team && !p.alive);
      if (deadTeammates.length === 0) {
        return { success: false, message: '現在倒れている味方がいません' };
      }

      // 最初に倒れた仲間を蘇生
      const target = deadTeammates[0];

      // パワー消費（1回のみ、使用後消滅）
      player.hasRevive = false;

      // 安全なリスポーン位置の選定
      let targetCol = target.spawnCol;
      let targetRow = target.spawnRow;

      // 元のスポーン位置がブロックや爆弾で埋まっている場合は、蘇生者の周囲の空きマスを探す
      if (this.map.isSolid(targetCol, targetRow) || this.getBombAt(targetCol, targetRow)) {
        const pTile = player.getTile();
        const candidates = [
          { col: pTile.col, row: pTile.row },
          { col: pTile.col + 1, row: pTile.row },
          { col: pTile.col - 1, row: pTile.row },
          { col: pTile.col, row: pTile.row + 1 },
          { col: pTile.col, row: pTile.row - 1 },
        ];
        for (const cand of candidates) {
          if (this.map.isPassable(cand.col, cand.row) && !this.getBombAt(cand.col, cand.row)) {
            targetCol = cand.col;
            targetRow = cand.row;
            break;
          }
        }
      }

      // 蘇生処理
      target.alive = true;
      target.x = targetCol * TILE_SIZE + TILE_SIZE / 2;
      target.y = targetRow * TILE_SIZE + TILE_SIZE / 2;
      target.activeBombs = 0;
      target.bombsInside.clear();
      // 3秒間の無敵シールド付与
      target.invulnerableUntil = Date.now() + PLAYER_DEFAULTS.INVULNERABLE_DURATION;

      this.io.to(this.roomId).emit('player_revived', {
        reviverId: player.id,
        reviverName: player.name,
        targetId: target.id,
        targetName: target.name,
        team: player.team,
        x: target.x,
        y: target.y,
      });

      this.io.to(this.roomId).emit('sound_event', { type: 'revive', col: targetCol, row: targetRow });
      return { success: true, targetName: target.name };
    } else {
      // FFAモードの場合: 自信への一時シールドとして発動
      player.hasRevive = false;
      player.invulnerableUntil = Date.now() + PLAYER_DEFAULTS.INVULNERABLE_DURATION;
      this.io.to(this.roomId).emit('sound_event', { type: 'revive', col: player.getTile().col, row: player.getTile().row });
      return { success: true };
    }
  }

  // 爆発処理
  triggerBombExplosion(bombId) {
    const bomb = this.bombs.get(bombId);
    if (!bomb) return;

    const owner = this.players.get(bomb.ownerId);
    if (owner && owner.activeBombs > 0) {
      owner.activeBombs--;
    }

    this.bombs.delete(bombId);

    const cells = [{ col: bomb.col, row: bomb.row, type: 'center' }];
    const chainBombIds = [];

    const directions = [
      { dx: 1, dy: 0, dir: 'right' },
      { dx: -1, dy: 0, dir: 'left' },
      { dx: 0, dy: 1, dir: 'down' },
      { dx: 0, dy: -1, dir: 'up' },
    ];

    for (const { dx, dy, dir } of directions) {
      for (let dist = 1; dist <= bomb.range; dist++) {
        const c = bomb.col + dx * dist;
        const r = bomb.row + dy * dist;

        if (!this.map.isInside(c, r)) break;

        const tile = this.map.getTile(c, r);

        // 破壊できない壁
        if (tile === 1) {
          break;
        }

        // 破壊可能ブロック
        if (tile === 2) {
          cells.push({ col: c, row: r, type: dir, isEnd: true });
          const droppedItem = this.map.destroyBlock(c, r);
          if (droppedItem) {
            this.io.to(this.roomId).emit('sound_event', { type: 'item_reveal', col: c, row: r });
          }
          break;
        }

        // 通路
        const isEnd = (dist === bomb.range);
        cells.push({ col: c, row: r, type: dir, isEnd });

        // アイテム焼失
        this.map.destroyItemAt(c, r);

        // 爆弾誘爆
        const otherBomb = this.getBombAt(c, r);
        if (otherBomb) {
          chainBombIds.push(otherBomb.id);
        }
      }
    }

    const explosion = {
      id: this.nextExplosionId++,
      cells,
      createdAt: Date.now(),
      duration: BOMB.EXPLOSION_TIME,
    };
    this.explosions.push(explosion);

    this.io.to(this.roomId).emit('sound_event', { type: 'explosion', col: bomb.col, row: bomb.row });

    // フレンドリーファイア有効: 味方も敵も爆風に当たれば判定対象
    this.checkExplosionHit(cells);

    // 誘爆を即時実行
    for (const chainedId of chainBombIds) {
      this.triggerBombExplosion(chainedId);
    }
  }

  // プレイヤーが爆風に当たったか判定 (無敵チェック & フレンドリーファイア)
  checkExplosionHit(cells) {
    for (const cell of cells) {
      const cellLeft = cell.col * TILE_SIZE;
      const cellRight = cellLeft + TILE_SIZE;
      const cellTop = cell.row * TILE_SIZE;
      const cellBottom = cellTop + TILE_SIZE;

      for (const player of this.players.values()) {
        if (!player.alive) continue;

        // 蘇生直後の無敵時間中は爆風ダメージ無効
        if (player.isInvulnerable()) continue;

        const pLeft = player.x - player.radius;
        const pRight = player.x + player.radius;
        const pTop = player.y - player.radius;
        const pBottom = player.y + player.radius;

        if (pRight > cellLeft && pLeft < cellRight && pBottom > cellTop && pTop < cellBottom) {
          player.alive = false;
          this.io.to(this.roomId).emit('sound_event', { type: 'player_death', col: cell.col, row: cell.row });
          this.io.to(this.roomId).emit('player_eliminated', {
            playerId: player.id,
            name: player.name,
            team: player.team,
          });
        }
      }
    }
  }

  // メインループ更新 (60Hz物理シミュレーション & 30Hz配信スロットル)
  tick() {
    if (this.state === 'PLAYING') {
      // 1. プレイヤーの移動 & アイテム拾得
      for (const [socketId, player] of this.players.entries()) {
        if (!player.alive) continue;
        const input = this.playerInputs.get(socketId) || { up: false, down: false, left: false, right: false };

        player.move(
          input,
          this.map,
          (c, r) => this.getBombAt(c, r),
          (bomb, dirX, dirY) => {
            const kicked = bomb.kick(dirX, dirY, (c, r, id) => this.isBlockedForBomb(c, r, id));
            if (kicked) {
              this.io.to(this.roomId).emit('sound_event', { type: 'bomb_kick', col: bomb.col, row: bomb.row });
            }
            return kicked;
          }
        );

        // アイテム取得判定
        const pTile = player.getTile();
        const pickedItem = this.map.pickItemAt(pTile.col, pTile.row);
        if (pickedItem) {
          player.applyItem(pickedItem.type);
          this.io.to(this.roomId).emit('sound_event', { type: 'item_pickup', itemType: pickedItem.type });
        }

        // 蘇生パワー保持中に倒れた味方の位置に接触した場合の自動蘇生アシスト
        if (player.hasRevive && this.gameMode !== GAME_MODES.FFA) {
          const deadTeammates = [...this.players.values()].filter(p => p.team === player.team && !p.alive);
          for (const dt of deadTeammates) {
            const dtTile = dt.getTile();
            if (dtTile.col === pTile.col && dtTile.row === pTile.row) {
              this.reviveTeammate(socketId);
              break;
            }
          }
        }
      }

      // 2. 爆弾の更新（移動・時間切れ爆破）
      const expiredBombIds = [];
      for (const bomb of this.bombs.values()) {
        bomb.update((c, r, id) => this.isBlockedForBomb(c, r, id));
        if (bomb.isExpired()) {
          expiredBombIds.push(bomb.id);
        }
      }

      for (const bombId of expiredBombIds) {
        this.triggerBombExplosion(bombId);
      }

      // 3. 爆風の持続時間更新 & 残留爆風によるダメージ
      const now = Date.now();
      this.explosions = this.explosions.filter(exp => now - exp.createdAt < exp.duration);
      for (const exp of this.explosions) {
        this.checkExplosionHit(exp.cells);
      }

      // 4. 勝敗判定
      this.checkGameEnd();
    }

    // ネットワーク負荷軽減のため、配信レートを30Hzに抑制
    const now = Date.now();
    if (now - this.lastBroadcastTime >= (1000 / BROADCAST_RATE) - 2) {
      this.lastBroadcastTime = now;
      this.broadcastGameState();
    }
  }

  checkGameEnd() {
    if (this.state !== 'PLAYING') return;

    const allPlayers = [...this.players.values()];

    // チーム戦モードの勝敗判定
    if (this.gameMode !== GAME_MODES.FFA) {
      const bluePlayers = allPlayers.filter(p => p.team === TEAMS.BLUE);
      const redPlayers = allPlayers.filter(p => p.team === TEAMS.RED);

      const aliveBlue = bluePlayers.filter(p => p.alive).length;
      const aliveRed = redPlayers.filter(p => p.alive).length;

      // 両チームにプレイヤーが存在する場合
      if (bluePlayers.length > 0 && redPlayers.length > 0) {
        if (aliveBlue === 0 && aliveRed === 0) {
          // 引き分け
          this.state = 'GAMEOVER';
          this.winner = null;
          this.winnerTeam = null;
          this.io.to(this.roomId).emit('game_over', {
            draw: true,
            mode: this.gameMode,
            teamScores: this.teamScores,
          });
        } else if (aliveBlue === 0 && aliveRed > 0) {
          // Redチーム勝利
          this.state = 'GAMEOVER';
          this.winnerTeam = TEAMS.RED;
          this.teamScores.red += 1;
          redPlayers.forEach(p => p.score += 1);
          this.io.to(this.roomId).emit('game_over', {
            winnerTeam: TEAMS.RED,
            winnerTeamName: 'Team Red',
            draw: false,
            mode: this.gameMode,
            teamScores: this.teamScores,
          });
        } else if (aliveRed === 0 && aliveBlue > 0) {
          // Blueチーム勝利
          this.state = 'GAMEOVER';
          this.winnerTeam = TEAMS.BLUE;
          this.teamScores.blue += 1;
          bluePlayers.forEach(p => p.score += 1);
          this.io.to(this.roomId).emit('game_over', {
            winnerTeam: TEAMS.BLUE,
            winnerTeamName: 'Team Blue',
            draw: false,
            mode: this.gameMode,
            teamScores: this.teamScores,
          });
        }
      } else if (allPlayers.length >= 1) {
        // 1人練習の場合
        const alivePlayers = allPlayers.filter(p => p.alive);
        if (alivePlayers.length === 0) {
          this.state = 'GAMEOVER';
          this.io.to(this.roomId).emit('game_over', { draw: true, mode: this.gameMode, teamScores: this.teamScores });
        }
      }
      return;
    }

    // 個人戦 (FFA) の勝敗判定
    const alivePlayers = allPlayers.filter(p => p.alive);
    if (allPlayers.length >= 2) {
      if (alivePlayers.length === 1) {
        this.state = 'GAMEOVER';
        this.winner = alivePlayers[0];
        this.winner.score += 1;
        this.io.to(this.roomId).emit('game_over', {
          winner: this.winner.toDTO(),
          draw: false,
          mode: this.gameMode,
        });
      } else if (alivePlayers.length === 0) {
        this.state = 'GAMEOVER';
        this.winner = null;
        this.io.to(this.roomId).emit('game_over', {
          winner: null,
          draw: true,
          mode: this.gameMode,
        });
      }
    } else if (allPlayers.length === 1) {
      if (alivePlayers.length === 0) {
        this.state = 'GAMEOVER';
        this.winner = null;
        this.io.to(this.roomId).emit('game_over', {
          winner: null,
          draw: true,
          mode: this.gameMode,
        });
      }
    }
  }

  broadcastGameState() {
    // グリッドデータは変更された時（ブロック破壊時等）のみ送信し、通常フレームでは除外してネットワーク帯域を80%以上削減
    const gridChanged = (this.map.gridVersion !== this.lastBroadcastGridVersion);
    if (gridChanged) {
      this.lastBroadcastGridVersion = this.map.gridVersion;
    }

    const payload = {
      state: this.state,
      gameMode: this.gameMode,
      teamScores: this.teamScores,
      gridVersion: this.map.gridVersion,
      grid: gridChanged ? this.map.grid : undefined, // 変更時のみ送信
      items: this.map.items,
      players: [...this.players.values()].map(p => p.toDTO()),
      bombs: [...this.bombs.values()].map(b => b.toDTO()),
      explosions: this.explosions.map(e => ({
        id: e.id,
        cells: e.cells,
        progress: (Date.now() - e.createdAt) / e.duration,
      })),
      hostSocketId: this.hostSocketId,
    };
    this.io.to(this.roomId).emit('game_state', payload);
  }

  broadcastLobbyState() {
    const payload = {
      state: this.state,
      gameMode: this.gameMode,
      mapTheme: this.mapTheme,
      teamScores: this.teamScores,
      players: [...this.players.values()].map(p => p.toDTO()),
      hostSocketId: this.hostSocketId,
    };
    this.io.to(this.roomId).emit('lobby_state', payload);
  }
}

module.exports = GameRoom;