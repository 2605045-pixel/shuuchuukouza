const { TILE_SIZE, BOMB } = require('./constants');

class Bomb {
  constructor(id, ownerId, col, row, range) {
    this.id = id;
    this.ownerId = ownerId;
    this.col = col;
    this.row = row;
    this.x = col * TILE_SIZE + TILE_SIZE / 2;
    this.y = row * TILE_SIZE + TILE_SIZE / 2;
    this.range = range;
    this.createdAt = Date.now();
    this.fuseTime = BOMB.FUSE_TIME;

    // キック移動用状態
    this.isMoving = false;
    this.moveDir = { dx: 0, dy: 0 };
    this.speed = BOMB.KICK_SPEED;
  }

  // キック開始判定
  kick(dx, dy, isBlockedFn) {
    // 既に動いている場合はキック方向の反転や変化も可能にするか、何もしないか
    if (this.isMoving) return false;

    const nextCol = this.col + dx;
    const nextRow = this.row + dy;

    // 次のマスが障害物（壁、ブロック、他爆弾など）で塞がっていれば滑らない
    if (isBlockedFn(nextCol, nextRow, this.id)) {
      return false;
    }

    this.moveDir = { dx, dy };
    this.isMoving = true;
    return true;
  }

  stop() {
    this.isMoving = false;
    this.moveDir = { dx: 0, dy: 0 };
    // タイル中心に正確にスナップ
    this.x = this.col * TILE_SIZE + TILE_SIZE / 2;
    this.y = this.row * TILE_SIZE + TILE_SIZE / 2;
  }

  update(isBlockedFn) {
    if (!this.isMoving) {
      return;
    }

    const { dx, dy } = this.moveDir;
    this.x += dx * this.speed;
    this.y += dy * this.speed;

    const prevCol = this.col;
    const prevRow = this.row;

    // 現在の中心に対応するマス
    const currentCol = Math.floor(this.x / TILE_SIZE);
    const currentRow = Math.floor(this.y / TILE_SIZE);
    this.col = currentCol;
    this.row = currentRow;

    // 次のマスの進行方向
    const nextCol = currentCol + dx;
    const nextRow = currentRow + dy;

    // 次のマスが塞がっているかチェック
    const nextIsBlocked = isBlockedFn(nextCol, nextRow, this.id);

    const tileCenterX = currentCol * TILE_SIZE + TILE_SIZE / 2;
    const tileCenterY = currentRow * TILE_SIZE + TILE_SIZE / 2;

    if (nextIsBlocked) {
      // 進行方向のマスの中心を越えたら停止
      if (dx > 0 && this.x >= tileCenterX) {
        this.x = tileCenterX;
        this.stop();
      } else if (dx < 0 && this.x <= tileCenterX) {
        this.x = tileCenterX;
        this.stop();
      } else if (dy > 0 && this.y >= tileCenterY) {
        this.y = tileCenterY;
        this.stop();
      } else if (dy < 0 && this.y <= tileCenterY) {
        this.y = tileCenterY;
        this.stop();
      }
    }
  }

  isExpired() {
    return Date.now() - this.createdAt >= this.fuseTime;
  }

  toDTO() {
    return {
      id: this.id,
      ownerId: this.ownerId,
      col: this.col,
      row: this.row,
      x: Math.round(this.x),
      y: Math.round(this.y),
      range: this.range,
      isMoving: this.isMoving,
      fuseLeft: Math.max(0, this.fuseTime - (Date.now() - this.createdAt)),
    };
  }
}

module.exports = Bomb;
