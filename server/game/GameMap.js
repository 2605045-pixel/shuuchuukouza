const { GRID_COLS, GRID_ROWS, TILE_TYPES, ITEM_TYPES, SPAWN_POINTS } = require('./constants');

class GameMap {
  constructor() {
    this.cols = GRID_COLS;
    this.rows = GRID_ROWS;
    this.grid = [];
    this.items = []; // { id, col, row, type }
    this.nextItemId = 1;
    this.generate();
  }

  generate() {
    this.grid = [];
    this.items = [];
    this.dirty = true; // generate直後は必ずgridを全クライアントへ送信する


    // スポーン地点とその隣接マス（プレイヤーが動けるようブロックを置かない）
    const protectedCells = new Set();
    for (const sp of SPAWN_POINTS) {
      protectedCells.add(`${sp.x},${sp.y}`);
      protectedCells.add(`${sp.x + 1},${sp.y}`);
      protectedCells.add(`${sp.x - 1},${sp.y}`);
      protectedCells.add(`${sp.x},${sp.y + 1}`);
      protectedCells.add(`${sp.x},${sp.y - 1}`);
    }

    for (let r = 0; r < this.rows; r++) {
      this.grid[r] = [];
      for (let c = 0; c < this.cols; c++) {
        // 外壁
        if (r === 0 || r === this.rows - 1 || c === 0 || c === this.cols - 1) {
          this.grid[r][c] = TILE_TYPES.WALL;
        }
        // 固定の柱 (偶数行かつ偶数列)
        else if (r % 2 === 0 && c % 2 === 0) {
          this.grid[r][c] = TILE_TYPES.WALL;
        }
        // スポーン周辺保護エリア
        else if (protectedCells.has(`${c},${r}`)) {
          this.grid[r][c] = TILE_TYPES.EMPTY;
        }
        // 破壊可能ソフトブロック（約75%で出現）
        else {
          if (Math.random() < 0.75) {
            this.grid[r][c] = TILE_TYPES.BLOCK;
          } else {
            this.grid[r][c] = TILE_TYPES.EMPTY;
          }
        }
      }
    }
  }

  isInside(c, r) {
    return c >= 0 && c < this.cols && r >= 0 && r < this.rows;
  }

  getTile(c, r) {
    if (!this.isInside(c, r)) return TILE_TYPES.WALL;
    return this.grid[r][c];
  }

  isSolid(c, r) {
    const tile = this.getTile(c, r);
    return tile === TILE_TYPES.WALL || tile === TILE_TYPES.BLOCK;
  }

  isPassable(c, r) {
    return this.isInside(c, r) && this.grid[r][c] === TILE_TYPES.EMPTY;
  }

  // ブロックを破壊してアイテムをドロップ
  destroyBlock(c, r) {
    if (!this.isInside(c, r)) return null;
    if (this.grid[r][c] === TILE_TYPES.BLOCK) {
      this.grid[r][c] = TILE_TYPES.EMPTY;
      this.dirty = true; // ブロック破壊でマップが変化したのでgrid送信を要求


      // 約50%の確率でアイテムドロップ
      if (Math.random() < 0.50) {
        // 重み付け: FIRE 30%, BOMB 30%, SPEED 20%, KICK 20%
        const rand = Math.random();
        let selectedType = ITEM_TYPES.FIRE;
        if (rand < 0.30) {
          selectedType = ITEM_TYPES.FIRE;
        } else if (rand < 0.60) {
          selectedType = ITEM_TYPES.BOMB;
        } else if (rand < 0.80) {
          selectedType = ITEM_TYPES.SPEED;
        } else {
          selectedType = ITEM_TYPES.KICK;
        }

        const item = {
          id: this.nextItemId++,
          col: c,
          row: r,
          type: selectedType,
        };
        this.items.push(item);
        return item;
      }
    }
    return null;
  }

  pickItemAt(c, r) {
    const index = this.items.findIndex(it => it.col === c && it.row === r);
    if (index !== -1) {
      const item = this.items[index];
      this.items.splice(index, 1);
      return item;
    }
    return null;
  }

  destroyItemAt(c, r) {
    const index = this.items.findIndex(it => it.col === c && it.row === r);
    if (index !== -1) {
      this.items.splice(index, 1);
      return true;
    }
    return false;
  }
}

module.exports = GameMap;
