const { GRID_COLS, GRID_ROWS, TILE_SIZE, SPAWN_POINTS, BOMB, TICK_RATE } = require('./constants');
const GameMap = require('./GameMap');
const Player = require('./Player');
const Bomb = require('./Bomb');

class GameRoom {
  constructor(roomId, io) {
    this.roomId = roomId;
    this.io = io;

    this.map = new GameMap();
    this.players = new Map(); // socketId => Player
    this.playerInputs = new Map(); // socketId => { up, down, left, right }
    this.bombs = new Map(); // bombId => Bomb
    this.nextBombId = 1;
    this.explosions = []; // { id, cells: [{col, row}], createdAt, duration }
    this.nextExplosionId = 1;

    this.state = 'LOBBY'; // 'LOBBY' | 'PLAYING' | 'GAMEOVER'
    this.winner = null;
    this.gameOverTimer = null;
    this.hostSocketId = null;

    this.intervalId = null;
    this.startLoop();
  }

  startLoop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      this.tick();
    }, 1000 / TICK_RATE);
  }

  stopLoop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  addPlayer(socketId, name) {
    // スポーン枠（最大8人）の空きを探す
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

    // 所持していた爆弾のownerId解除または削除
    for (const [bombId, bomb] of this.bombs.entries()) {
      if (bomb.ownerId === socketId) {
        // 残すか爆破させる
      }
    }

    this.players.delete(socketId);
    this.playerInputs.delete(socketId);

    if (this.hostSocketId === socketId) {
      const remainingIds = [...this.players.keys()];
      this.hostSocketId = remainingIds.length > 0 ? remainingIds[0] : null;
    }

    if (this.state === 'PLAYING') {
      this.checkGameEnd();
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
    // ホストまたは単独プレイ時の開始許可
    if (this.hostSocketId !== socketId && this.players.size > 1) {
      return { success: false, message: 'ホストのみがゲームを開始できます' };
    }

    this.map.generate();
    this.bombs.clear();
    this.explosions = [];
    this.winner = null;

    // 全プレイヤー初期化
    for (const player of this.players.values()) {
      player.resetRound();
    }

    this.state = 'PLAYING';
    this.io.to(this.roomId).emit('game_started');
    return { success: true };
  }

  restartGame(socketId) {
    return this.startGame(socketId);
  }

  // 爆弾設置
  placeBomb(socketId) {
    if (this.state !== 'PLAYING') return;
    const player = this.players.get(socketId);
    if (!player || !player.canPlaceBomb()) return;

    const tile = player.getTile();
    // 既に同じマスに爆弾があれば置けない
    const existingBomb = this.getBombAt(tile.col, tile.row);
    if (existingBomb) return;

    // 固いブロックや壁の上には置けない
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
    // マップ外・壁・ブロック
    if (this.map.isSolid(col, row)) return true;

    // 他の爆弾
    for (const bomb of this.bombs.values()) {
      if (bomb.id !== ignoreBombId && bomb.col === col && bomb.row === row) {
        return true;
      }
    }

    // 生存プレイヤーがいるマス
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

  // 爆発処理
  triggerBombExplosion(bombId) {
    const bomb = this.bombs.get(bombId);
    if (!bomb) return;

    // オーナーの設置カウント減少
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

        // 破壊できない壁（外壁・柱）
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
          break; // ブロックで爆風はストップ
        }

        // 通路
        const isEnd = (dist === bomb.range);
        cells.push({ col: c, row: r, type: dir, isEnd });

        // アイテムがあれば焼失
        this.map.destroyItemAt(c, r);

        // 爆弾があれば誘爆
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

    // 爆風接触プレイヤー判定
    this.checkExplosionHit(cells);

    // 誘爆を即時実行
    for (const chainedId of chainBombIds) {
      this.triggerBombExplosion(chainedId);
    }
  }

  // プレイヤーが爆風に当たったか
  checkExplosionHit(cells) {
    for (const cell of cells) {
      const cellLeft = cell.col * TILE_SIZE;
      const cellRight = cellLeft + TILE_SIZE;
      const cellTop = cell.row * TILE_SIZE;
      const cellBottom = cellTop + TILE_SIZE;

      for (const player of this.players.values()) {
        if (!player.alive) continue;

        // プレイヤーの円とタイルの矩形の交差判定
        const pLeft = player.x - player.radius;
        const pRight = player.x + player.radius;
        const pTop = player.y - player.radius;
        const pBottom = player.y + player.radius;

        if (pRight > cellLeft && pLeft < cellRight && pBottom > cellTop && pTop < cellBottom) {
          player.alive = false;
          this.io.to(this.roomId).emit('sound_event', { type: 'player_death', col: cell.col, row: cell.row });
        }
      }
    }
  }

  // メインループ更新
  tick() {
    if (this.state === 'PLAYING') {
      // 1. プレイヤーの移動
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

    // 状態のブロードキャスト
    this.broadcastGameState();
  }

  checkGameEnd() {
    if (this.state !== 'PLAYING') return;

    const allPlayers = [...this.players.values()];
    const alivePlayers = allPlayers.filter(p => p.alive);

    // 2人以上の対戦の場合
    if (allPlayers.length >= 2) {
      if (alivePlayers.length === 1) {
        // 勝者決定
        this.state = 'GAMEOVER';
        this.winner = alivePlayers[0];
        this.winner.score += 1;
        this.io.to(this.roomId).emit('game_over', {
          winner: this.winner.toDTO(),
          draw: false,
        });
      } else if (alivePlayers.length === 0) {
        // 引き分け
        this.state = 'GAMEOVER';
        this.winner = null;
        this.io.to(this.roomId).emit('game_over', {
          winner: null,
          draw: true,
        });
      }
    } else if (allPlayers.length === 1) {
      // 1人練習モードの場合
      if (alivePlayers.length === 0) {
        this.state = 'GAMEOVER';
        this.winner = null;
        this.io.to(this.roomId).emit('game_over', {
          winner: null,
          draw: true,
        });
      }
    }
  }

  broadcastGameState() {
    const payload = {
      state: this.state,
      grid: this.map.grid,
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
      players: [...this.players.values()].map(p => p.toDTO()),
      hostSocketId: this.hostSocketId,
    };
    this.io.to(this.roomId).emit('lobby_state', payload);
  }
}

module.exports = GameRoom;
