class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tileSize = 48;
    this.cols = 15;
    this.rows = 13;
  }

  render(gameState, myPlayerId) {
    if (!gameState || !gameState.grid) return;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 1. 床と固定壁・破壊可能ブロックの描画
    this.drawMap(gameState.grid);

    // 2. アイテムの描画
    if (gameState.items) {
      this.drawItems(gameState.items);
    }

    // 3. 爆弾の描画
    if (gameState.bombs) {
      this.drawBombs(gameState.bombs);
    }

    // 4. 爆風の描画
    if (gameState.explosions) {
      this.drawExplosions(gameState.explosions);
    }

    // 5. プレイヤーの描画
    if (gameState.players) {
      this.drawPlayers(gameState.players, myPlayerId);
    }
  }

  drawMap(grid) {
    const ctx = this.ctx;
    const ts = this.tileSize;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = c * ts;
        const y = r * ts;
        const tile = grid[r] ? grid[r][c] : 0;

        // 通路（床）
        if ((r + c) % 2 === 0) {
          ctx.fillStyle = '#1e293b';
        } else {
          ctx.fillStyle = '#192231';
        }
        ctx.fillRect(x, y, ts, ts);

        // タイル境界の薄いグリッド線
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.strokeRect(x, y, ts, ts);

        // 固定壁（外壁・柱）: 1
        if (tile === 1) {
          this.drawSolidWall(x, y, ts);
        }
        // 破壊可能ブロック: 2
        else if (tile === 2) {
          this.drawDestructibleBlock(x, y, ts);
        }
      }
    }
  }

  // 固定の頑丈な壁
  drawSolidWall(x, y, size) {
    const ctx = this.ctx;
    // 側面・立体感
    ctx.fillStyle = '#334155';
    ctx.fillRect(x, y, size, size);

    // 윗면（ハイライト）
    ctx.fillStyle = '#475569';
    ctx.fillRect(x + 3, y + 3, size - 6, size - 10);

    // ハイライト枠線
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3, y + 3, size - 6, size - 10);

    // 中央のリベット装飾
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(x + size / 2, y + (size - 7) / 2 + 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 破壊可能なソフトブロック
  drawDestructibleBlock(x, y, size) {
    const ctx = this.ctx;
    const pad = 2;
    const bw = size - pad * 2;
    const bh = size - pad * 2;

    // レンガ調ブロック
    ctx.fillStyle = '#92400e';
    ctx.fillRect(x + pad, y + pad, bw, bh);

    ctx.fillStyle = '#b45309';
    ctx.fillRect(x + pad + 2, y + pad + 2, bw - 4, bh - 6);

    // レンガ模様の目地
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 2;
    // 水平分割
    ctx.beginPath();
    ctx.moveTo(x + pad, y + size / 2);
    ctx.lineTo(x + pad + bw, y + size / 2);
    // 垂直分割（上半分と下半分でずらす）
    ctx.moveTo(x + size / 2, y + pad);
    ctx.lineTo(x + size / 2, y + size / 2);
    ctx.moveTo(x + size * 0.3, y + size / 2);
    ctx.lineTo(x + size * 0.3, y + pad + bh);
    ctx.moveTo(x + size * 0.75, y + size / 2);
    ctx.lineTo(x + size * 0.75, y + pad + bh);
    ctx.stroke();

    // 縁取り
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + pad + 2, y + pad + 2, bw - 4, bh - 4);
  }

  // アイテム
  drawItems(items) {
    const ctx = this.ctx;
    const ts = this.tileSize;
    const now = Date.now();
    const bob = Math.sin(now / 180) * 3; // 上下ふんわり浮遊アニメーション

    for (const item of items) {
      const cx = item.col * ts + ts / 2;
      const cy = item.row * ts + ts / 2 + bob;

      ctx.save();

      // オーラグロー
      let glowColor = '#3b82f6';
      let icon = '💣';
      let label = 'BOMB';

      if (item.type === 'fire') {
        glowColor = '#f97316';
        icon = '🔥';
        label = '+FIRE';
      } else if (item.type === 'speed') {
        glowColor = '#10b981';
        icon = '👟';
        label = '+SPD';
      } else if (item.type === 'kick') {
        glowColor = '#fbbf24';
        icon = '⚡';
        label = 'KICK';
      }

      // アイテム台座
      const grad = ctx.createRadialGradient(cx, cy, 5, cx, cy, 20);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
      grad.addColorStop(0.6, glowColor);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.fill();

      // アイコン文字
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, cx, cy - 2);

      // 小ラベル
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 4;
      ctx.fillText(label, cx, cy + 13);

      ctx.restore();
    }
  }

  // 爆弾
  drawBombs(bombs) {
    const ctx = this.ctx;
    const now = Date.now();

    for (const bomb of bombs) {
      ctx.save();

      // 脈動効果 (残り時間が短いほど激しく脈動)
      let scale = 1.0;
      if (bomb.fuseLeft < 1000) {
        const pulseSpeed = bomb.fuseLeft < 500 ? 50 : 120;
        scale = 1.0 + Math.sin(now / pulseSpeed) * 0.12;
      }

      const bx = bomb.x;
      const by = bomb.y;
      const r = 16 * scale;

      // 移動中（キック時）のスピードライン演出
      if (bomb.isMoving) {
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(bx, by, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 爆弾本体の影
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.ellipse(bx, by + 14, r * 0.9, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // 爆弾の黒球グラデーション
      const grad = ctx.createRadialGradient(bx - 4, by - 6, 2, bx, by, r);
      grad.addColorStop(0, '#64748b');
      grad.addColorStop(0.3, '#1e293b');
      grad.addColorStop(1, '#020617');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();

      // 光沢ハイライト
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.beginPath();
      ctx.arc(bx - 5, by - 6, 4, 0, Math.PI * 2);
      ctx.fill();

      // 導火線の口金
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(bx - 3, by - r - 3, 6, 4);

      // パチパチ燃える導火線の火花
      const sparkColor = Math.random() > 0.5 ? '#f59e0b' : '#ef4444';
      ctx.fillStyle = sparkColor;
      ctx.beginPath();
      ctx.arc(bx + (Math.random() * 4 - 2), by - r - 5, 3 + Math.random() * 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  // 爆風
  drawExplosions(explosions) {
    const ctx = this.ctx;
    const ts = this.tileSize;

    for (const exp of explosions) {
      const alpha = Math.max(0, 1 - exp.progress); // 爆風減衰

      for (const cell of exp.cells) {
        const cx = cell.col * ts + ts / 2;
        const cy = cell.row * ts + ts / 2;

        ctx.save();
        ctx.globalAlpha = alpha;

        // 外炎（赤〜オレンジ）
        const fireGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, ts * 0.55);
        fireGrad.addColorStop(0, '#ffffff'); // 白熱の中心
        fireGrad.addColorStop(0.3, '#fde047'); // 黄色
        fireGrad.addColorStop(0.7, '#f97316'); // オレンジ
        fireGrad.addColorStop(1, 'rgba(239, 68, 68, 0)'); // 赤の拡散

        ctx.fillStyle = fireGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, ts * 0.55, 0, Math.PI * 2);
        ctx.fill();

        // 四角い爆風の広がり
        ctx.fillStyle = 'rgba(249, 115, 22, 0.7)';
        ctx.fillRect(cx - ts * 0.45, cy - ts * 0.45, ts * 0.9, ts * 0.9);

        // 中央の強烈な光
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(cx - ts * 0.25, cy - ts * 0.25, ts * 0.5, ts * 0.5);

        ctx.restore();
      }
    }
  }

  // プレイヤー
  drawPlayers(players, myPlayerId) {
    const ctx = this.ctx;
    const now = Date.now();

    for (const player of players) {
      const px = player.x;
      const py = player.y;

      ctx.save();

      if (!player.alive) {
        // 死亡時は天使ゴーストの描画
        const floatY = py - 10 + Math.sin(now / 300) * 4;
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(px, floatY, 14, 0, Math.PI * 2);
        ctx.fill();

        // 天使の輪
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(px, floatY - 18, 10, 4, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText(player.name, px, floatY - 26);
        ctx.restore();
        continue;
      }

      // 生存中プレイヤー
      // 足元の影
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.ellipse(px, py + 15, 14, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // 移動中の上下揺れ（アニメーション）
      const bob = player.isMoving ? Math.abs(Math.sin(now / 80)) * 3 : 0;
      const charY = py - bob;

      // キック機能所持時の足元オーラ
      if (player.stats && player.stats.canKick) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py + 14, 13, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 胴体
      ctx.fillStyle = player.color || '#3b82f6';
      ctx.beginPath();
      ctx.arc(px, charY, 16, 0, Math.PI * 2);
      ctx.fill();

      // ヘルメットハイライト
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.beginPath();
      ctx.arc(px - 4, charY - 6, 5, 0, Math.PI * 2);
      ctx.fill();

      // バイザー・顔（向きに応じてオフセット）
      let faceOffsetX = 0;
      let faceOffsetY = 0;
      if (player.facing === 'left') faceOffsetX = -5;
      if (player.facing === 'right') faceOffsetX = 5;
      if (player.facing === 'up') faceOffsetY = -5;
      if (player.facing === 'down') faceOffsetY = 4;

      // バイザー
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(px + faceOffsetX, charY + faceOffsetY, 9, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // 目（黒目）
      if (player.facing !== 'up') {
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(px + faceOffsetX - 3, charY + faceOffsetY, 1.8, 0, Math.PI * 2);
        ctx.arc(px + faceOffsetX + 3, charY + faceOffsetY, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // 名前タグ
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 4;
      ctx.fillText(player.name, px, charY - 22);

      // 自分自身（YOU）のマーカー
      if (player.id === myPlayerId) {
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.moveTo(px, charY - 32);
        ctx.lineTo(px - 6, charY - 40);
        ctx.lineTo(px + 6, charY - 40);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }
  }
}

window.GameRenderer = GameRenderer;
