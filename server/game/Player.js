const { TILE_SIZE, PLAYER_DEFAULTS, ITEM_TYPES } = require('./constants');

class Player {
  constructor(id, name, color, spawnCol, spawnRow, spawnIndex) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.spawnIndex = spawnIndex;

    this.spawnCol = spawnCol;
    this.spawnRow = spawnRow;

    this.radius = PLAYER_DEFAULTS.HITBOX_RADIUS;
    this.bombsInside = new Set();
    this.resetPosition();

    this.alive = true;
    this.score = 0;

    // パワーアップステータス
    this.speed = PLAYER_DEFAULTS.BASE_SPEED;
    this.maxBombs = PLAYER_DEFAULTS.BASE_BOMBS;
    this.bombRange = PLAYER_DEFAULTS.BASE_RANGE;
    this.canKick = PLAYER_DEFAULTS.CAN_KICK;

    // 現在設置中の爆弾数
    this.activeBombs = 0;

    this.facing = 'down';
    this.isMoving = false;
  }

  resetPosition() {
    this.x = this.spawnCol * TILE_SIZE + TILE_SIZE / 2;
    this.y = this.spawnRow * TILE_SIZE + TILE_SIZE / 2;
    this.facing = 'down';
    this.isMoving = false;
    this.bombsInside.clear();
  }

  resetRound() {
    this.alive = true;
    this.activeBombs = 0;
    this.speed = PLAYER_DEFAULTS.BASE_SPEED;
    this.maxBombs = PLAYER_DEFAULTS.BASE_BOMBS;
    this.bombRange = PLAYER_DEFAULTS.BASE_RANGE;
    this.canKick = PLAYER_DEFAULTS.CAN_KICK;
    this.resetPosition();
  }

  getTile() {
    return {
      col: Math.floor(this.x / TILE_SIZE),
      row: Math.floor(this.y / TILE_SIZE),
    };
  }

  // 設置可能か
  canPlaceBomb() {
    return this.alive && this.activeBombs < this.maxBombs;
  }

  // 入力に基づく移動・衝突判定・コーナー補正・キック
  move(input, map, getBombAtFn, onKickFn) {
    if (!this.alive) return;

    let dx = 0;
    let dy = 0;

    if (input.up) { dy -= 1; this.facing = 'up'; }
    if (input.down) { dy += 1; this.facing = 'down'; }
    if (input.left) { dx -= 1; this.facing = 'left'; }
    if (input.right) { dx += 1; this.facing = 'right'; }

    if (dx === 0 && dy === 0) {
      this.isMoving = false;
      this.cleanupBombsInside(getBombAtFn);
      return;
    }

    this.isMoving = true;

    // 斜め移動時の正規化
    if (dx !== 0 && dy !== 0) {
      dx *= 0.7071;
      dy *= 0.7071;
    }

    const moveDistX = dx * this.speed;
    const moveDistY = dy * this.speed;

    // X軸移動と衝突判定
    if (moveDistX !== 0) {
      const nextX = this.x + moveDistX;
      const collision = this.checkCollision(nextX, this.y, map, getBombAtFn, Math.sign(dx), 0, onKickFn);
      if (!collision.blocked) {
        this.x = nextX;
      } else {
        // コーナー補正（Y軸の中心へ寄せる）
        this.applyCornerCorrectionY(map, getBombAtFn, Math.sign(dx));
      }
    }

    // Y軸移動と衝突判定
    if (moveDistY !== 0) {
      const nextY = this.y + moveDistY;
      const collision = this.checkCollision(this.x, nextY, map, getBombAtFn, 0, Math.sign(dy), onKickFn);
      if (!collision.blocked) {
        this.y = nextY;
      } else {
        // コーナー補正（X軸の中心へ寄せる）
        this.applyCornerCorrectionX(map, getBombAtFn, Math.sign(dy));
      }
    }

    // 抜け出た爆弾の衝突除外リストを更新
    this.cleanupBombsInside(getBombAtFn);
  }

  // 移動先で衝突があるかチェック
  checkCollision(targetX, targetY, map, getBombAtFn, dirX, dirY, onKickFn) {
    const box = {
      left: targetX - this.radius,
      right: targetX + this.radius,
      top: targetY - this.radius,
      bottom: targetY + this.radius,
    };

    const minCol = Math.floor(box.left / TILE_SIZE);
    const maxCol = Math.floor(box.right / TILE_SIZE);
    const minRow = Math.floor(box.top / TILE_SIZE);
    const maxRow = Math.floor(box.bottom / TILE_SIZE);

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        // マップ上の壁・ブロック
        if (map.isSolid(c, r)) {
          return { blocked: true };
        }

        // 爆弾チェック
        const bomb = getBombAtFn(c, r);
        if (bomb) {
          // すでに中に入っている爆弾ならすり抜け可能
          if (this.bombsInside.has(bomb.id)) {
            continue;
          }

          // キック能力があればキックを試行
          if (this.canKick && (dirX !== 0 || dirY !== 0) && onKickFn) {
            const kicked = onKickFn(bomb, dirX, dirY);
            if (kicked) {
              // キック成功したら進めるか、次のフレームで進めるように今回は止まる
              return { blocked: true };
            }
          }
          return { blocked: true, bomb };
        }
      }
    }

    return { blocked: false };
  }

  // Y軸の角を曲がりやすくするアシスト（水平移動時）
  applyCornerCorrectionY(map, getBombAtFn, dirX) {
    const currentTileY = Math.floor(this.y / TILE_SIZE);
    const tileCenterY = currentTileY * TILE_SIZE + TILE_SIZE / 2;
    const offset = this.y - tileCenterY;
    const nudgeSpeed = Math.min(Math.abs(offset), this.speed * 0.7);

    if (Math.abs(offset) > 1.0 && Math.abs(offset) < 22) {
      const nudgeDir = offset > 0 ? -1 : 1;
      const targetY = this.y + nudgeDir * nudgeSpeed;
      const check = this.checkCollision(this.x, targetY, map, getBombAtFn, 0, 0, null);
      if (!check.blocked) {
        this.y = targetY;
      }
    }
  }

  // X軸の角を曲がりやすくするアシスト（垂直移動時）
  applyCornerCorrectionX(map, getBombAtFn, dirY) {
    const currentTileX = Math.floor(this.x / TILE_SIZE);
    const tileCenterX = currentTileX * TILE_SIZE + TILE_SIZE / 2;
    const offset = this.x - tileCenterX;
    const nudgeSpeed = Math.min(Math.abs(offset), this.speed * 0.7);

    if (Math.abs(offset) > 1.0 && Math.abs(offset) < 22) {
      const nudgeDir = offset > 0 ? -1 : 1;
      const targetX = this.x + nudgeDir * nudgeSpeed;
      const check = this.checkCollision(targetX, this.y, map, getBombAtFn, 0, 0, null);
      if (!check.blocked) {
        this.x = targetX;
      }
    }
  }

  cleanupBombsInside(getBombAtFn) {
    if (this.bombsInside.size === 0) return;

    const myBox = {
      left: this.x - this.radius,
      right: this.x + this.radius,
      top: this.y - this.radius,
      bottom: this.y + this.radius,
    };

    for (const bombId of this.bombsInside) {
      // 爆弾タイルの矩形と交差していなければ除外リストから削除
      let stillInside = false;
      // 各マスチェック
      const minCol = Math.floor(myBox.left / TILE_SIZE);
      const maxCol = Math.floor(myBox.right / TILE_SIZE);
      const minRow = Math.floor(myBox.top / TILE_SIZE);
      const maxRow = Math.floor(myBox.bottom / TILE_SIZE);

      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          const bomb = getBombAtFn(c, r);
          if (bomb && bomb.id === bombId) {
            stillInside = true;
            break;
          }
        }
        if (stillInside) break;
      }

      if (!stillInside) {
        this.bombsInside.delete(bombId);
      }
    }
  }

  applyItem(itemType) {
    switch (itemType) {
      case ITEM_TYPES.FIRE:
        if (this.bombRange < PLAYER_DEFAULTS.MAX_RANGE) {
          this.bombRange += 1;
        }
        break;
      case ITEM_TYPES.BOMB:
        if (this.maxBombs < PLAYER_DEFAULTS.MAX_BOMBS) {
          this.maxBombs += 1;
        }
        break;
      case ITEM_TYPES.SPEED:
        if (this.speed < PLAYER_DEFAULTS.MAX_SPEED) {
          this.speed = Math.min(this.speed + PLAYER_DEFAULTS.SPEED_INC, PLAYER_DEFAULTS.MAX_SPEED);
        }
        break;
      case ITEM_TYPES.KICK:
        this.canKick = true;
        break;
    }
  }

  toDTO() {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      x: Math.round(this.x),
      y: Math.round(this.y),
      alive: this.alive,
      score: this.score,
      facing: this.facing,
      isMoving: this.isMoving,
      stats: {
        speed: Math.round(this.speed * 10) / 10,
        maxBombs: this.maxBombs,
        bombRange: this.bombRange,
        canKick: this.canKick,
      },
    };
  }
}

module.exports = Player;
