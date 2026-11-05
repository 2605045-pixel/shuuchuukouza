/**
 * p2p-game-engine.js
 * ホストブラウザで動くゲームロジック。
 * サーバー側の GameRoom / Player / Bomb / GameMap を JS に移植したもの。
 */

// ==================== 定数 ====================
const P2P_CONSTANTS = {
  GRID_COLS: 15,
  GRID_ROWS: 13,
  TILE_SIZE: 48,
  TILE_TYPES: { EMPTY: 0, WALL: 1, BLOCK: 2 },
  ITEM_TYPES: { FIRE: 'fire', BOMB: 'bomb', SPEED: 'speed', KICK: 'kick' },
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
  },
  BOMB: {
    FUSE_TIME: 3000,
    EXPLOSION_TIME: 600,
    KICK_SPEED: 7.0,
    SIZE: 38,
  },
  SPAWN_POINTS: [
    { x: 1,  y: 1,  color: '#3b82f6', name: 'Blue'   },
    { x: 13, y: 11, color: '#ef4444', name: 'Red'    },
    { x: 13, y: 1,  color: '#10b981', name: 'Green'  },
    { x: 1,  y: 11, color: '#f59e0b', name: 'Yellow' },
    { x: 7,  y: 1,  color: '#8b5cf6', name: 'Purple' },
    { x: 7,  y: 11, color: '#ec4899', name: 'Pink'   },
    { x: 1,  y: 5,  color: '#06b6d4', name: 'Cyan'   },
    { x: 13, y: 7,  color: '#f97316', name: 'Orange' },
  ],
  TICK_RATE: 60,
};

// ==================== GameMap ====================
class P2PGameMap {
  constructor() {
    const C = P2P_CONSTANTS;
    this.cols = C.GRID_COLS;
    this.rows = C.GRID_ROWS;
    this.grid = [];
    this.items = [];
    this.nextItemId = 1;
    this.generate();
  }

  generate() {
    const C = P2P_CONSTANTS;
    const TT = C.TILE_TYPES;
    this.items = [];
    this.dirty = true;

    const protectedCells = new Set();
    for (const sp of C.SPAWN_POINTS) {
      [[0,0],[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy]) => {
        protectedCells.add(`${sp.x+dx},${sp.y+dy}`);
      });
    }

    this.grid = [];
    for (let r = 0; r < this.rows; r++) {
      this.grid[r] = [];
      for (let c = 0; c < this.cols; c++) {
        if (r === 0 || r === this.rows-1 || c === 0 || c === this.cols-1) {
          this.grid[r][c] = TT.WALL;
        } else if (r % 2 === 0 && c % 2 === 0) {
          this.grid[r][c] = TT.WALL;
        } else if (protectedCells.has(`${c},${r}`)) {
          this.grid[r][c] = TT.EMPTY;
        } else {
          this.grid[r][c] = Math.random() < 0.75 ? TT.BLOCK : TT.EMPTY;
        }
      }
    }
  }

  isInside(c, r) { return c >= 0 && c < this.cols && r >= 0 && r < this.rows; }
  getTile(c, r)  { return this.isInside(c, r) ? this.grid[r][c] : P2P_CONSTANTS.TILE_TYPES.WALL; }
  isSolid(c, r)  { const t = this.getTile(c, r); return t === 1 || t === 2; }
  isPassable(c, r) { return this.isInside(c, r) && this.grid[r][c] === 0; }

  destroyBlock(c, r) {
    const C = P2P_CONSTANTS;
    if (!this.isInside(c, r)) return null;
    if (this.grid[r][c] !== C.TILE_TYPES.BLOCK) return null;

    this.grid[r][c] = C.TILE_TYPES.EMPTY;
    this.dirty = true;

    if (Math.random() < 0.50) {
      const rand = Math.random();
      let type = C.ITEM_TYPES.FIRE;
      if (rand < 0.30)      type = C.ITEM_TYPES.FIRE;
      else if (rand < 0.60) type = C.ITEM_TYPES.BOMB;
      else if (rand < 0.80) type = C.ITEM_TYPES.SPEED;
      else                   type = C.ITEM_TYPES.KICK;

      const item = { id: this.nextItemId++, col: c, row: r, type };
      this.items.push(item);
      return item;
    }
    return null;
  }

  pickItemAt(c, r) {
    const idx = this.items.findIndex(it => it.col === c && it.row === r);
    if (idx !== -1) { return this.items.splice(idx, 1)[0]; }
    return null;
  }

  destroyItemAt(c, r) {
    const idx = this.items.findIndex(it => it.col === c && it.row === r);
    if (idx !== -1) { this.items.splice(idx, 1); return true; }
    return false;
  }
}

// ==================== P2PPlayer ====================
class P2PPlayer {
  constructor(id, name, color, spawnCol, spawnRow, spawnIndex) {
    const D = P2P_CONSTANTS.PLAYER_DEFAULTS;
    const TS = P2P_CONSTANTS.TILE_SIZE;

    this.id          = id;
    this.name        = name;
    this.color       = color;
    this.spawnIndex  = spawnIndex;
    this.spawnCol    = spawnCol;
    this.spawnRow    = spawnRow;
    this.radius      = D.HITBOX_RADIUS;
    this.bombsInside = new Set();
    this.alive       = true;
    this.score       = 0;
    this.speed       = D.BASE_SPEED;
    this.maxBombs    = D.BASE_BOMBS;
    this.bombRange   = D.BASE_RANGE;
    this.canKick     = D.CAN_KICK;
    this.activeBombs = 0;
    this.facing      = 'down';
    this.isMoving    = false;

    this.x = spawnCol * TS + TS / 2;
    this.y = spawnRow * TS + TS / 2;
  }

  resetPosition() {
    const TS = P2P_CONSTANTS.TILE_SIZE;
    this.x = this.spawnCol * TS + TS / 2;
    this.y = this.spawnRow * TS + TS / 2;
    this.facing = 'down';
    this.isMoving = false;
    this.bombsInside.clear();
  }

  resetRound() {
    const D = P2P_CONSTANTS.PLAYER_DEFAULTS;
    this.alive       = true;
    this.activeBombs = 0;
    this.speed       = D.BASE_SPEED;
    this.maxBombs    = D.BASE_BOMBS;
    this.bombRange   = D.BASE_RANGE;
    this.canKick     = D.CAN_KICK;
    this.resetPosition();
  }

  getTile() {
    const TS = P2P_CONSTANTS.TILE_SIZE;
    return { col: Math.floor(this.x / TS), row: Math.floor(this.y / TS) };
  }

  canPlaceBomb() { return this.alive && this.activeBombs < this.maxBombs; }

  move(input, map, getBombAtFn, onKickFn) {
    if (!this.alive) return;
    let dx = 0, dy = 0;
    if (input.up)    { dy -= 1; this.facing = 'up';    }
    if (input.down)  { dy += 1; this.facing = 'down';  }
    if (input.left)  { dx -= 1; this.facing = 'left';  }
    if (input.right) { dx += 1; this.facing = 'right'; }

    if (dx === 0 && dy === 0) {
      this.isMoving = false;
      this.cleanupBombsInside(getBombAtFn);
      return;
    }
    this.isMoving = true;
    if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

    const mx = dx * this.speed;
    const my = dy * this.speed;

    if (mx !== 0) {
      const c = this.checkCollision(this.x + mx, this.y, map, getBombAtFn, Math.sign(dx), 0, onKickFn);
      if (!c.blocked) this.x += mx;
      else this._cornerCorrectionY(map, getBombAtFn);
    }
    if (my !== 0) {
      const c = this.checkCollision(this.x, this.y + my, map, getBombAtFn, 0, Math.sign(dy), onKickFn);
      if (!c.blocked) this.y += my;
      else this._cornerCorrectionX(map, getBombAtFn);
    }
    this.cleanupBombsInside(getBombAtFn);
  }

  checkCollision(tx, ty, map, getBombAtFn, dirX, dirY, onKickFn) {
    const TS = P2P_CONSTANTS.TILE_SIZE;
    const box = { left: tx - this.radius, right: tx + this.radius,
                  top:  ty - this.radius, bottom: ty + this.radius };
    const minC = Math.floor(box.left  / TS), maxC = Math.floor(box.right  / TS);
    const minR = Math.floor(box.top   / TS), maxR = Math.floor(box.bottom / TS);

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (map.isSolid(c, r)) return { blocked: true };
        const bomb = getBombAtFn(c, r);
        if (bomb) {
          if (this.bombsInside.has(bomb.id)) continue;
          if (this.canKick && (dirX !== 0 || dirY !== 0) && onKickFn) {
            if (onKickFn(bomb, dirX, dirY)) return { blocked: true };
          }
          return { blocked: true, bomb };
        }
      }
    }
    return { blocked: false };
  }

  _cornerCorrectionY(map, getBombAtFn) {
    const TS = P2P_CONSTANTS.TILE_SIZE;
    const tileY = Math.floor(this.y / TS);
    const center = tileY * TS + TS / 2;
    const off = this.y - center;
    const nudge = Math.min(Math.abs(off), this.speed * 0.7);
    if (Math.abs(off) > 1.0 && Math.abs(off) < 22) {
      const dir = off > 0 ? -1 : 1;
      const c = this.checkCollision(this.x, this.y + dir * nudge, map, getBombAtFn, 0, 0, null);
      if (!c.blocked) this.y += dir * nudge;
    }
  }

  _cornerCorrectionX(map, getBombAtFn) {
    const TS = P2P_CONSTANTS.TILE_SIZE;
    const tileX = Math.floor(this.x / TS);
    const center = tileX * TS + TS / 2;
    const off = this.x - center;
    const nudge = Math.min(Math.abs(off), this.speed * 0.7);
    if (Math.abs(off) > 1.0 && Math.abs(off) < 22) {
      const dir = off > 0 ? -1 : 1;
      const c = this.checkCollision(this.x + dir * nudge, this.y, map, getBombAtFn, 0, 0, null);
      if (!c.blocked) this.x += dir * nudge;
    }
  }

  cleanupBombsInside(getBombAtFn) {
    if (this.bombsInside.size === 0) return;
    const TS = P2P_CONSTANTS.TILE_SIZE;
    const box = { left: this.x - this.radius, right: this.x + this.radius,
                  top:  this.y - this.radius,  bottom: this.y + this.radius };
    const minC = Math.floor(box.left  / TS), maxC = Math.floor(box.right  / TS);
    const minR = Math.floor(box.top   / TS), maxR = Math.floor(box.bottom / TS);

    for (const bid of this.bombsInside) {
      let inside = false;
      outer: for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const b = getBombAtFn(c, r);
          if (b && b.id === bid) { inside = true; break outer; }
        }
      }
      if (!inside) this.bombsInside.delete(bid);
    }
  }

  applyItem(type) {
    const D = P2P_CONSTANTS.PLAYER_DEFAULTS;
    const IT = P2P_CONSTANTS.ITEM_TYPES;
    switch (type) {
      case IT.FIRE:  if (this.bombRange < D.MAX_RANGE) this.bombRange += 1; break;
      case IT.BOMB:  if (this.maxBombs < D.MAX_BOMBS) this.maxBombs += 1; break;
      case IT.SPEED: this.speed = Math.min(this.speed + D.SPEED_INC, D.MAX_SPEED); break;
      case IT.KICK:  this.canKick = true; break;
    }
  }

  toDTO() {
    return {
      id: this.id, name: this.name, color: this.color,
      x: Math.round(this.x), y: Math.round(this.y),
      alive: this.alive, score: this.score,
      facing: this.facing, isMoving: this.isMoving,
      stats: {
        speed:    Math.round(this.speed * 10) / 10,
        maxBombs: this.maxBombs,
        bombRange: this.bombRange,
        canKick:  this.canKick,
      },
    };
  }
}

// ==================== P2PBomb ====================
class P2PBomb {
  constructor(id, ownerId, col, row, range) {
    const TS = P2P_CONSTANTS.TILE_SIZE;
    const B  = P2P_CONSTANTS.BOMB;
    this.id        = id;
    this.ownerId   = ownerId;
    this.col       = col;
    this.row       = row;
    this.x         = col * TS + TS / 2;
    this.y         = row * TS + TS / 2;
    this.range     = range;
    this.createdAt = Date.now();
    this.fuseTime  = B.FUSE_TIME;
    this.isMoving  = false;
    this.moveDir   = { dx: 0, dy: 0 };
    this.speed     = B.KICK_SPEED;
  }

  kick(dx, dy, isBlockedFn) {
    if (this.isMoving) return false;
    if (isBlockedFn(this.col + dx, this.row + dy, this.id)) return false;
    this.moveDir  = { dx, dy };
    this.isMoving = true;
    return true;
  }

  stop() {
    const TS = P2P_CONSTANTS.TILE_SIZE;
    this.isMoving = false;
    this.moveDir  = { dx: 0, dy: 0 };
    this.x = this.col * TS + TS / 2;
    this.y = this.row * TS + TS / 2;
  }

  update(isBlockedFn) {
    if (!this.isMoving) return;
    const TS = P2P_CONSTANTS.TILE_SIZE;
    const { dx, dy } = this.moveDir;
    this.x += dx * this.speed;
    this.y += dy * this.speed;

    this.col = Math.floor(this.x / TS);
    this.row = Math.floor(this.y / TS);

    const nextCol = this.col + dx;
    const nextRow = this.row + dy;
    const blocked = isBlockedFn(nextCol, nextRow, this.id);
    const cx = this.col * TS + TS / 2;
    const cy = this.row * TS + TS / 2;

    if (blocked) {
      if ((dx > 0 && this.x >= cx) || (dx < 0 && this.x <= cx)) { this.x = cx; this.stop(); }
      else if ((dy > 0 && this.y >= cy) || (dy < 0 && this.y <= cy)) { this.y = cy; this.stop(); }
    }
  }

  isExpired() { return Date.now() - this.createdAt >= this.fuseTime; }

  toDTO() {
    return {
      id: this.id, ownerId: this.ownerId,
      col: this.col, row: this.row,
      x: Math.round(this.x), y: Math.round(this.y),
      range: this.range, isMoving: this.isMoving,
      fuseLeft: Math.max(0, this.fuseTime - (Date.now() - this.createdAt)),
    };
  }
}

// ==================== P2PGameEngine (ホスト側ゲームロジック) ====================
class P2PGameEngine {
  /**
   * @param {function(string, object)} emitToAll - 全クライアントへのメッセージ送信コールバック
   * @param {function(string, string, object)} emitToOne - 特定クライアントへの送信コールバック
   */
  constructor(emitToAll, emitToOne) {
    this.emitToAll = emitToAll;
    this.emitToOne = emitToOne;

    this.map         = new P2PGameMap();
    this.players     = new Map(); // peerId => P2PPlayer
    this.playerInputs = new Map(); // peerId => {up,down,left,right}
    this.bombs       = new Map(); // bombId => P2PBomb
    this.nextBombId  = 1;
    this.explosions  = [];
    this.nextExplosionId = 1;

    this.state       = 'LOBBY';
    this.winner      = null;
    this.hostPeerId  = null;

    this.intervalId  = null;
  }

  startLoop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.tick(), 1000 / P2P_CONSTANTS.TICK_RATE);
  }

  stopLoop() {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
  }

  // ホスト自身を最初のプレイヤーとして追加
  addPlayer(peerId, name) {
    const C = P2P_CONSTANTS;
    const usedIdx = new Set([...this.players.values()].map(p => p.spawnIndex));
    let slotIdx = 0;
    for (let i = 0; i < C.SPAWN_POINTS.length; i++) {
      if (!usedIdx.has(i)) { slotIdx = i; break; }
    }
    const sp = C.SPAWN_POINTS[slotIdx];
    const playerName = (name && name.trim().length > 0) ? name.trim().slice(0, 12) : `Player ${slotIdx + 1}`;
    const player = new P2PPlayer(peerId, playerName, sp.color, sp.x, sp.y, slotIdx);

    this.players.set(peerId, player);
    this.playerInputs.set(peerId, { up: false, down: false, left: false, right: false });

    if (!this.hostPeerId) this.hostPeerId = peerId;

    this.broadcastLobbyState();
    return player;
  }

  removePlayer(peerId) {
    if (!this.players.has(peerId)) return;
    this.players.delete(peerId);
    this.playerInputs.delete(peerId);

    if (this.hostPeerId === peerId) {
      const ids = [...this.players.keys()];
      this.hostPeerId = ids.length > 0 ? ids[0] : null;
    }
    if (this.state === 'PLAYING') this.checkGameEnd();
    this.broadcastLobbyState();
  }

  handleInput(peerId, input) {
    if (this.playerInputs.has(peerId)) {
      this.playerInputs.set(peerId, {
        up: !!input.up, down: !!input.down,
        left: !!input.left, right: !!input.right,
      });
    }
  }

  startGame(requesterId) {
    if (this.hostPeerId !== requesterId && this.players.size > 1) {
      return { success: false, message: 'ホストのみがゲームを開始できます' };
    }
    this.map.generate();
    this.bombs.clear();
    this.explosions = [];
    this.winner     = null;
    for (const p of this.players.values()) p.resetRound();

    this.state = 'PLAYING';
    this.emitToAll('game_started', {});
    return { success: true };
  }

  restartGame(requesterId) { return this.startGame(requesterId); }

  placeBomb(peerId) {
    if (this.state !== 'PLAYING') return;
    const player = this.players.get(peerId);
    if (!player || !player.canPlaceBomb()) return;

    const tile = player.getTile();
    if (this.getBombAt(tile.col, tile.row)) return;
    if (this.map.isSolid(tile.col, tile.row)) return;

    const bombId = this.nextBombId++;
    const bomb = new P2PBomb(bombId, player.id, tile.col, tile.row, player.bombRange);
    this.bombs.set(bombId, bomb);
    player.activeBombs++;
    player.bombsInside.add(bombId);

    this.emitToAll('sound_event', { type: 'bomb_drop', col: tile.col, row: tile.row });
  }

  getBombAt(col, row) {
    for (const b of this.bombs.values()) {
      if (b.col === col && b.row === row) return b;
    }
    return null;
  }

  isBlockedForBomb(col, row, ignoreBombId) {
    if (this.map.isSolid(col, row)) return true;
    for (const b of this.bombs.values()) {
      if (b.id !== ignoreBombId && b.col === col && b.row === row) return true;
    }
    for (const p of this.players.values()) {
      if (p.alive) {
        const pt = p.getTile();
        if (pt.col === col && pt.row === row) return true;
      }
    }
    return false;
  }

  triggerBombExplosion(bombId) {
    const bomb = this.bombs.get(bombId);
    if (!bomb) return;

    const owner = this.players.get(bomb.ownerId);
    if (owner && owner.activeBombs > 0) owner.activeBombs--;
    this.bombs.delete(bombId);

    const cells = [{ col: bomb.col, row: bomb.row, type: 'center' }];
    const chainIds = [];
    const dirs = [
      { dx: 1, dy: 0, dir: 'right' },
      { dx: -1, dy: 0, dir: 'left' },
      { dx: 0, dy: 1, dir: 'down' },
      { dx: 0, dy: -1, dir: 'up' },
    ];

    for (const { dx, dy, dir } of dirs) {
      for (let dist = 1; dist <= bomb.range; dist++) {
        const c = bomb.col + dx * dist;
        const r = bomb.row + dy * dist;
        if (!this.map.isInside(c, r)) break;
        const tile = this.map.getTile(c, r);
        if (tile === 1) break;
        if (tile === 2) {
          cells.push({ col: c, row: r, type: dir, isEnd: true });
          const item = this.map.destroyBlock(c, r);
          if (item) this.emitToAll('sound_event', { type: 'item_reveal', col: c, row: r });
          break;
        }
        const isEnd = (dist === bomb.range);
        cells.push({ col: c, row: r, type: dir, isEnd });
        this.map.destroyItemAt(c, r);
        const other = this.getBombAt(c, r);
        if (other) chainIds.push(other.id);
      }
    }

    this.explosions.push({
      id: this.nextExplosionId++,
      cells,
      createdAt: Date.now(),
      duration: P2P_CONSTANTS.BOMB.EXPLOSION_TIME,
    });

    this.emitToAll('sound_event', { type: 'explosion', col: bomb.col, row: bomb.row });
    this.checkExplosionHit(cells);
    for (const cid of chainIds) this.triggerBombExplosion(cid);
  }

  checkExplosionHit(cells) {
    const TS = P2P_CONSTANTS.TILE_SIZE;
    for (const cell of cells) {
      const cl = cell.col * TS, cr = cl + TS;
      const ct = cell.row * TS, cb = ct + TS;
      for (const player of this.players.values()) {
        if (!player.alive) continue;
        if (player.x + player.radius > cl && player.x - player.radius < cr &&
            player.y + player.radius > ct && player.y - player.radius < cb) {
          player.alive = false;
          this.emitToAll('sound_event', { type: 'player_death', col: cell.col, row: cell.row });
        }
      }
    }
  }

  tick() {
    if (this.state === 'PLAYING') {
      // 1. プレイヤー移動
      for (const [pid, player] of this.players.entries()) {
        if (!player.alive) continue;
        const input = this.playerInputs.get(pid) || { up: false, down: false, left: false, right: false };
        player.move(
          input,
          this.map,
          (c, r) => this.getBombAt(c, r),
          (bomb, dirX, dirY) => {
            const kicked = bomb.kick(dirX, dirY, (c, r, id) => this.isBlockedForBomb(c, r, id));
            if (kicked) this.emitToAll('sound_event', { type: 'bomb_kick', col: bomb.col, row: bomb.row });
            return kicked;
          }
        );
        const pTile = player.getTile();
        const picked = this.map.pickItemAt(pTile.col, pTile.row);
        if (picked) {
          player.applyItem(picked.type);
          this.emitToAll('sound_event', { type: 'item_pickup', itemType: picked.type });
        }
      }

      // 2. 爆弾更新
      const expired = [];
      for (const bomb of this.bombs.values()) {
        bomb.update((c, r, id) => this.isBlockedForBomb(c, r, id));
        if (bomb.isExpired()) expired.push(bomb.id);
      }
      for (const bid of expired) this.triggerBombExplosion(bid);

      // 3. 爆風持続
      const now = Date.now();
      this.explosions = this.explosions.filter(e => now - e.createdAt < e.duration);
      for (const exp of this.explosions) this.checkExplosionHit(exp.cells);

      // 4. 勝敗判定
      this.checkGameEnd();
    }

    this.broadcastGameState();
  }

  checkGameEnd() {
    if (this.state !== 'PLAYING') return;
    const all   = [...this.players.values()];
    const alive = all.filter(p => p.alive);

    if (all.length >= 2) {
      if (alive.length === 1) {
        this.state  = 'GAMEOVER';
        this.winner = alive[0];
        this.winner.score += 1;
        this.emitToAll('game_over', { winner: this.winner.toDTO(), draw: false });
      } else if (alive.length === 0) {
        this.state  = 'GAMEOVER';
        this.winner = null;
        this.emitToAll('game_over', { winner: null, draw: true });
      }
    } else if (all.length === 1 && alive.length === 0) {
      this.state  = 'GAMEOVER';
      this.winner = null;
      this.emitToAll('game_over', { winner: null, draw: true });
    }
  }

  broadcastGameState() {
    const payload = {
      state:      this.state,
      items:      this.map.items,
      players:    [...this.players.values()].map(p => p.toDTO()),
      bombs:      [...this.bombs.values()].map(b => b.toDTO()),
      explosions: this.explosions.map(e => ({
        id:       e.id,
        cells:    e.cells,
        progress: (Date.now() - e.createdAt) / e.duration,
      })),
      hostPeerId: this.hostPeerId,
    };
    if (this.map.dirty) {
      payload.grid = this.map.grid;
      this.map.dirty = false;
    }
    this.emitToAll('game_state', payload);
  }

  broadcastLobbyState() {
    this.emitToAll('lobby_state', {
      state:      this.state,
      players:    [...this.players.values()].map(p => p.toDTO()),
      hostPeerId: this.hostPeerId,
    });
  }
}

window.P2PGameEngine  = P2PGameEngine;
window.P2P_CONSTANTS  = P2P_CONSTANTS;
