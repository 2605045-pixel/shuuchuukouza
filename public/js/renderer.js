class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tileSize = 48;
    this.cols = 15;
    this.rows = 13;

    // パフォーマンス最適化: マップ描画用オフスクリーンキャンバス
    this.mapCanvas = document.createElement('canvas');
    this.mapCanvas.width = canvas.width;
    this.mapCanvas.height = canvas.height;
    this.mapCtx = this.mapCanvas.getContext('2d');

    this.cachedGridVersion = -1;
    this.currentTheme = 'cyber';

    // 演出用パーティクルプール
    this.particles = [];
    this.reviveBeams = []; // { fromX, fromY, toX, toY, startTime, duration }

    // キャラクターのまばたきタイマー
    this.blinkTimer = 0;
    this.isBlinking = false;
  }

  // 外部からの蘇生演出トリガー
  addReviveBeam(fromX, fromY, toX, toY) {
    this.reviveBeams.push({
      fromX,
      fromY,
      toX,
      toY,
      startTime: Date.now(),
      duration: 1200,
    });

    // 蘇生地点に光のスパークパーティクルを生成
    for (let i = 0; i < 24; i++) {
      const angle = (Math.PI * 2 * i) / 24;
      const speed = 2 + Math.random() * 3;
      this.particles.push({
        x: toX,
        y: toY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        color: Math.random() > 0.4 ? '#fbbf24' : '#f43f5e',
        radius: 2.5 + Math.random() * 2.5,
        alpha: 1.0,
        decay: 0.02 + Math.random() * 0.02,
      });
    }
  }

  // ブロック破壊時の破片パーティクル
  addBlockDebris(col, row, theme) {
    const ts = this.tileSize;
    const cx = col * ts + ts / 2;
    const cy = row * ts + ts / 2;
    const colors = theme === 'cyber' ? ['#0ea5e9', '#38bdf8', '#0284c7'] :
                   theme === 'ruins' ? ['#b45309', '#d97706', '#78350f'] :
                   ['#ea580c', '#f97316', '#7f1d1d'];

    for (let i = 0; i < 12; i++) {
      this.particles.push({
        x: cx + (Math.random() * 20 - 10),
        y: cy + (Math.random() * 20 - 10),
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5 - 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        radius: 2 + Math.random() * 3,
        alpha: 1.0,
        decay: 0.035,
      });
    }
  }

  render(gameState, myPlayerId, interpolatedPlayers) {
    if (!gameState) return;

    const ctx = this.ctx;
    const now = Date.now();

    // まばたきアニメーションの更新
    if (now > this.blinkTimer) {
      this.isBlinking = !this.isBlinking;
      this.blinkTimer = now + (this.isBlinking ? 120 : 3200 + Math.random() * 1800);
    }

    // 1. オフスクリーンマップキャッシュの更新判定 (変更があった時のみ再描画で超高速化)
    const theme = gameState.mapTheme || this.currentTheme || 'cyber';
    if (gameState.grid && (gameState.gridVersion !== this.cachedGridVersion || theme !== this.currentTheme)) {
      this.currentTheme = theme;
      this.cachedGridVersion = gameState.gridVersion || 0;
      this.renderMapToCache(gameState.grid, theme);
    }

    // 画面クリア
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 2. キャッシュされたマップ背景を1回のdrawImageで高速描画！
    ctx.drawImage(this.mapCanvas, 0, 0);

    // 3. アイテムの描画
    if (gameState.items) {
      this.drawItems(gameState.items);
    }

    // 4. 爆弾の描画
    if (gameState.bombs) {
      this.drawBombs(gameState.bombs);
    }

    // 5. 爆風の描画
    if (gameState.explosions) {
      this.drawExplosions(gameState.explosions);
    }

    // 6. パーティクル演出
    this.updateAndDrawParticles();

    // 7. 蘇生光線演出
    this.drawReviveBeams();

    // 8. プレイヤーキャラクターの描画（滑らかな補間座標を使用）
    const playersToDraw = interpolatedPlayers || gameState.players;
    if (playersToDraw) {
      this.drawPlayers(playersToDraw, myPlayerId);
    }
  }

  // ==========================================
  // マップキャッシュ生成（テーマ別プロシージャル美化）
  // ==========================================
  renderMapToCache(grid, theme) {
    const ctx = this.mapCtx;
    const ts = this.tileSize;

    ctx.clearRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = c * ts;
        const y = r * ts;
        const tile = grid[r] ? grid[r][c] : 0;

        // 床の描画
        this.drawFloorTile(ctx, x, y, ts, c, r, theme);

        // 固定壁（柱・外壁）
        if (tile === 1) {
          this.drawSolidWall(ctx, x, y, ts, c, r, theme);
        }
        // 破壊可能ブロック
        else if (tile === 2) {
          this.drawDestructibleBlock(ctx, x, y, ts, c, r, theme);
        }
      }
    }
  }

  // 床タイル
  drawFloorTile(ctx, x, y, ts, c, r, theme) {
    const isEven = (c + r) % 2 === 0;

    if (theme === 'cyber') {
      // サイバーパンク・ネオングリッド
      ctx.fillStyle = isEven ? '#0a0f1d' : '#070b16';
      ctx.fillRect(x, y, ts, ts);

      // ネオン回路グリッド線
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, ts, ts);

      // 交差点の光点
      if (c % 2 === 1 && r % 2 === 1) {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
        ctx.fillRect(x + ts / 2 - 2, y + ts / 2 - 2, 4, 4);
      }
    } else if (theme === 'ruins') {
      // 古代遺跡・エメラルドストーン
      ctx.fillStyle = isEven ? '#1e2c26' : '#192420';
      ctx.fillRect(x, y, ts, ts);

      ctx.strokeStyle = 'rgba(16, 185, 129, 0.08)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, ts, ts);

      // コケのアクセント
      if ((c * 7 + r * 13) % 5 === 0) {
        ctx.fillStyle = 'rgba(5, 150, 105, 0.15)';
        ctx.fillRect(x + 4, y + 4, 8, 8);
      }
    } else {
      // マグマ要塞
      ctx.fillStyle = isEven ? '#1f1311' : '#170e0c';
      ctx.fillRect(x, y, ts, ts);

      ctx.strokeStyle = 'rgba(239, 68, 68, 0.1)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, ts, ts);

      // 溶岩亀裂
      if ((c * 3 + r * 7) % 6 === 0) {
        ctx.strokeStyle = 'rgba(249, 115, 22, 0.25)';
        ctx.beginPath();
        ctx.moveTo(x + 4, y + ts / 2);
        ctx.lineTo(x + ts - 4, y + ts / 2 + 2);
        ctx.stroke();
      }
    }
  }

  // 固定の頑丈な壁（柱・外壁）
  drawSolidWall(ctx, x, y, ts, c, r, theme) {
    const isPerimeter = (r === 0 || r === this.rows - 1 || c === 0 || c === this.cols - 1);

    // 柱の下の立体影
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x + 3, y + ts - 4, ts - 6, 6);

    if (theme === 'cyber') {
      // サイバーチタン柱
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(x, y, ts, ts);

      // 上面プレート
      ctx.fillStyle = '#334155';
      ctx.fillRect(x + 3, y + 3, ts - 6, ts - 8);

      // ネオンエッジ
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 3, y + 3, ts - 6, ts - 8);

      // 中央の六角形/コア
      ctx.fillStyle = '#0891b2';
      ctx.beginPath();
      ctx.arc(x + ts / 2, y + ts / 2 - 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#67e8f9';
      ctx.beginPath();
      ctx.arc(x + ts / 2, y + ts / 2 - 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (theme === 'ruins') {
      // 古代ルーン石柱
      ctx.fillStyle = '#2d3748';
      ctx.fillRect(x, y, ts, ts);

      ctx.fillStyle = '#4a5568';
      ctx.fillRect(x + 3, y + 3, ts - 6, ts - 8);

      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 4, y + 4, ts - 8, ts - 10);

      // エメラルドルーン刻印
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + ts / 2, y + 10);
      ctx.lineTo(x + ts / 2, y + ts - 14);
      ctx.moveTo(x + 12, y + ts / 2 - 2);
      ctx.lineTo(x + ts - 12, y + ts / 2 - 2);
      ctx.stroke();
    } else {
      // 黒曜石マグマ柱
      ctx.fillStyle = '#18181b';
      ctx.fillRect(x, y, ts, ts);

      ctx.fillStyle = '#27272a';
      ctx.fillRect(x + 3, y + 3, ts - 6, ts - 8);

      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 3, y + 3, ts - 6, ts - 8);

      // 溶岩コア
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(x + ts / 2, y + ts / 2 - 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(x + ts / 2, y + ts / 2 - 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 破壊可能なブロック（木箱・コンテナ）
  drawDestructibleBlock(ctx, x, y, ts, c, r, theme) {
    const pad = 2;
    const bw = ts - pad * 2;
    const bh = ts - pad * 2;

    // 接地影
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x + pad, y + ts - 4, bw, 5);

    if (theme === 'cyber') {
      // ハイテク・ホログラムクレート
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x + pad, y + pad, bw, bh);

      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(x + pad + 2, y + pad + 2, bw - 4, bh - 6);

      // ハザードストライプ・コーナー
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + pad + 2, y + pad + 2, bw - 4, bh - 6);

      // X字の補強フレーム
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
      ctx.beginPath();
      ctx.moveTo(x + pad + 3, y + pad + 3);
      ctx.lineTo(x + pad + bw - 3, y + pad + bh - 5);
      ctx.moveTo(x + pad + bw - 3, y + pad + 3);
      ctx.lineTo(x + pad + 3, y + pad + bh - 5);
      ctx.stroke();

      // 中央の警告アイコン
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x + ts / 2 - 3, y + ts / 2 - 4, 6, 6);
    } else if (theme === 'ruins') {
      // 木製宝箱・頑丈な木箱
      ctx.fillStyle = '#78350f';
      ctx.fillRect(x + pad, y + pad, bw, bh);

      ctx.fillStyle = '#b45309';
      ctx.fillRect(x + pad + 2, y + pad + 2, bw - 4, bh - 6);

      // 木目板の分割線
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + pad + 2, y + pad + bh * 0.33);
      ctx.lineTo(x + pad + bw - 2, y + pad + bh * 0.33);
      ctx.moveTo(x + pad + 2, y + pad + bh * 0.66);
      ctx.lineTo(x + pad + bw - 2, y + pad + bh * 0.66);
      ctx.stroke();

      // 金具のリベット補強
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + pad + 2, y + pad + 2, bw - 4, bh - 6);
    } else {
      // 灼熱のブラストコンテナ
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(x + pad, y + pad, bw, bh);

      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(x + pad + 2, y + pad + 2, bw - 4, bh - 6);

      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + pad + 2, y + pad + 2, bw - 4, bh - 6);

      // 警告斜線
      ctx.fillStyle = 'rgba(251, 191, 36, 0.4)';
      ctx.beginPath();
      ctx.moveTo(x + pad + 4, y + pad + 4);
      ctx.lineTo(x + pad + 16, y + pad + 4);
      ctx.lineTo(x + pad + 4, y + pad + 16);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ==========================================
  // アイテム描画（💖 復活パワー含む）
  // ==========================================
  drawItems(items) {
    const ctx = this.ctx;
    const ts = this.tileSize;
    const now = Date.now();
    const bob = Math.sin(now / 160) * 3;

    for (const item of items) {
      const cx = item.col * ts + ts / 2;
      const cy = item.row * ts + ts / 2 + bob;

      ctx.save();

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
      } else if (item.type === 'revive') {
        glowColor = '#f43f5e';
        icon = '💖';
        label = 'REVIVE';
      }

      // 台座オーラ
      const grad = ctx.createRadialGradient(cx, cy, 3, cx, cy, 21);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.5, glowColor);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 21, 0, Math.PI * 2);
      ctx.fill();

      // 復活アイテムは天使の光輪エフェクト
      if (item.type === 'revive') {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(cx, cy - 16, 8, 3, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

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
      ctx.fillText(label, cx, cy + 14);

      ctx.restore();
    }
  }

  // ==========================================
  // 爆弾描画
  // ==========================================
  drawBombs(bombs) {
    const ctx = this.ctx;
    const now = Date.now();

    for (const bomb of bombs) {
      ctx.save();

      // 脈動効果
      let scale = 1.0;
      if (bomb.fuseLeft < 1000) {
        const pulseSpeed = bomb.fuseLeft < 500 ? 55 : 120;
        scale = 1.0 + Math.sin(now / pulseSpeed) * 0.12;
      }

      const bx = bomb.x;
      const by = bomb.y;
      const r = 16 * scale;

      // キック移動中のスピードライン
      if (bomb.isMoving) {
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(bx, by, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 影
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.ellipse(bx, by + 14, r * 0.9, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // 爆弾球体
      const grad = ctx.createRadialGradient(bx - 4, by - 6, 2, bx, by, r);
      grad.addColorStop(0, '#64748b');
      grad.addColorStop(0.3, '#1e293b');
      grad.addColorStop(1, '#020617');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();

      // 光沢ハイライト
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.beginPath();
      ctx.arc(bx - 5, by - 6, 4, 0, Math.PI * 2);
      ctx.fill();

      // 導火線の口金
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(bx - 3, by - r - 3, 6, 4);

      // パチパチ燃える火花
      const sparkColor = Math.random() > 0.5 ? '#f59e0b' : '#ef4444';
      ctx.fillStyle = sparkColor;
      ctx.beginPath();
      ctx.arc(bx + (Math.random() * 4 - 2), by - r - 5, 3 + Math.random() * 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  // ==========================================
  // 爆風描画
  // ==========================================
  drawExplosions(explosions) {
    const ctx = this.ctx;
    const ts = this.tileSize;

    for (const exp of explosions) {
      const alpha = Math.max(0, 1 - exp.progress);

      for (const cell of exp.cells) {
        const cx = cell.col * ts + ts / 2;
        const cy = cell.row * ts + ts / 2;

        ctx.save();
        ctx.globalAlpha = alpha;

        const fireGrad = ctx.createRadialGradient(cx, cy, 3, cx, cy, ts * 0.55);
        fireGrad.addColorStop(0, '#ffffff');
        fireGrad.addColorStop(0.25, '#fde047');
        fireGrad.addColorStop(0.65, '#f97316');
        fireGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');

        ctx.fillStyle = fireGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, ts * 0.55, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(249, 115, 22, 0.7)';
        ctx.fillRect(cx - ts * 0.42, cy - ts * 0.42, ts * 0.84, ts * 0.84);

        ctx.fillStyle = '#fef08a';
        ctx.fillRect(cx - ts * 0.22, cy - ts * 0.22, ts * 0.44, ts * 0.44);

        ctx.restore();
      }
    }
  }

  // ==========================================
  // 蘇生光線エフェクト
  // ==========================================
  drawReviveBeams() {
    const ctx = this.ctx;
    const now = Date.now();

    this.reviveBeams = this.reviveBeams.filter(beam => now - beam.startTime < beam.duration);

    for (const beam of this.reviveBeams) {
      const p = (now - beam.startTime) / beam.duration;
      const alpha = Math.sin(p * Math.PI);

      ctx.save();
      ctx.globalAlpha = alpha;

      // 蘇生光線（ゴールド・ピンクのビーム）
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 4 + Math.sin(p * 10) * 2;
      ctx.beginPath();
      ctx.moveTo(beam.fromX, beam.fromY);
      ctx.lineTo(beam.toX, beam.toY);
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(beam.fromX, beam.fromY);
      ctx.lineTo(beam.toX, beam.toY);
      ctx.stroke();

      // 蘇生地点に広がる同心円リング
      const ringRadius = p * 40;
      ctx.strokeStyle = 'rgba(251, 191, 36, ' + (1 - p) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(beam.toX, beam.toY, ringRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }
  }

  // ==========================================
  // パーティクル更新 & 描画
  // ==========================================
  updateAndDrawParticles() {
    const ctx = this.ctx;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= p.decay;

      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ==========================================
  // プレイヤーキャラクター描画（高品質スタイライズド・ボンバーマン）
  // ==========================================
  drawPlayers(players, myPlayerId) {
    const ctx = this.ctx;
    const now = Date.now();

    for (const player of players) {
      const px = player.x;
      const py = player.y;

      ctx.save();

      // 1. 死亡時（可愛い天使ゴースト）
      if (!player.alive) {
        const floatY = py - 12 + Math.sin(now / 280) * 4;
        ctx.globalAlpha = 0.75;

        // ゴーストの影
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.beginPath();
        ctx.ellipse(px, py + 12, 10, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // 天使の翼
        const wingFlap = Math.sin(now / 150) * 3;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(px - 14, floatY - 2, 7, 4 + wingFlap, -0.3, 0, Math.PI * 2);
        ctx.ellipse(px + 14, floatY - 2, 7, 4 + wingFlap, 0.3, 0, Math.PI * 2);
        ctx.fill();

        // ゴースト胴体（ふんわり白い霊体）
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(px, floatY, 13, Math.PI, 0, false);
        ctx.lineTo(px + 13, floatY + 8);
        ctx.quadraticCurveTo(px + 6, floatY + 14, px, floatY + 10);
        ctx.quadraticCurveTo(px - 6, floatY + 14, px - 13, floatY + 8);
        ctx.closePath();
        ctx.fill();

        // 困り目・うるうる目
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(px - 4, floatY - 1, 2, 0, Math.PI * 2);
        ctx.arc(px + 4, floatY - 1, 2, 0, Math.PI * 2);
        ctx.fill();

        // 天使の輪（ゴールド）
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(px, floatY - 18, 9, 3.5, 0, 0, Math.PI * 2);
        ctx.stroke();

        // チーム名札
        this.drawPlayerTag(ctx, player, px, floatY - 26, myPlayerId);
        ctx.restore();
        continue;
      }

      // 2. 生存プレイヤーの描画
      // 足元のリアルな楕円影
      ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
      ctx.beginPath();
      ctx.ellipse(px, py + 16, 15, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // 移動アニメーションの歩行サイクル
      const isMoving = player.isMoving;
      const walkCycle = isMoving ? Math.sin(now / 90) : 0;
      const bob = isMoving ? Math.abs(Math.sin(now / 90)) * 3 : 0;
      const charY = py - bob;

      // チーム所属カラーとアクセント
      const isBlue = (player.team === 'blue');
      const isRed = (player.team === 'red');
      const baseColor = player.color || (isBlue ? '#3b82f6' : isRed ? '#ef4444' : '#10b981');
      const darkColor = isBlue ? '#1e3a8a' : isRed ? '#991b1b' : '#064e3b';
      const trimColor = isBlue ? '#60a5fa' : isRed ? '#f87171' : '#34d399';

      // 2.1 脚・ブーツの描画（歩行時に左右交互に前後に振れる）
      const legOffset = walkCycle * 4;
      ctx.fillStyle = '#0f172a'; // ダークブーツ

      // 左足
      ctx.beginPath();
      ctx.ellipse(px - 6, py + 14 - (isMoving ? legOffset : 0), 4.5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // 右足
      ctx.beginPath();
      ctx.ellipse(px + 6, py + 14 + (isMoving ? legOffset : 0), 4.5, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // ブーツ金具ハイライト
      ctx.fillStyle = trimColor;
      ctx.fillRect(px - 7, py + 12 - (isMoving ? legOffset : 0), 3, 2);
      ctx.fillRect(px + 5, py + 12 + (isMoving ? legOffset : 0), 3, 2);

      // 2.2 胴体・スーツ
      ctx.fillStyle = darkColor;
      ctx.beginPath();
      ctx.ellipse(px, charY + 5, 11, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      // 胸のスーツアーマープレート
      ctx.fillStyle = baseColor;
      ctx.beginPath();
      ctx.ellipse(px, charY + 4, 8, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      // ベルトとバックル
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(px - 9, charY + 8, 18, 3.5);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(px - 3, charY + 7.5, 6, 4.5);

      // 2.3 手・グローブ（白手袋）
      const armSwing = walkCycle * 3;
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(px - 13, charY + 6 + armSwing, 4, 0, Math.PI * 2);
      ctx.arc(px + 13, charY + 6 - armSwing, 4, 0, Math.PI * 2);
      ctx.fill();

      // 2.4 キック能力保持者の足元エフェクト
      if (player.stats && player.stats.canKick) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py + 14, 14, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 2.5 ボンバーマン頭部・ヘルメット
      const headY = charY - 6;

      // ヘルメット本体（立体球状グラデーション）
      const helmGrad = ctx.createRadialGradient(px - 5, headY - 6, 2, px, headY, 15);
      helmGrad.addColorStop(0, '#ffffff');
      helmGrad.addColorStop(0.35, baseColor);
      helmGrad.addColorStop(1, darkColor);
      ctx.fillStyle = helmGrad;
      ctx.beginPath();
      ctx.arc(px, headY, 15, 0, Math.PI * 2);
      ctx.fill();

      // ヘルメット頂点のアンテナ棒 & ポンポン球
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(px, headY - 14);
      const antennaSway = isMoving ? Math.sin(now / 90) * 3 : 0;
      ctx.lineTo(px + antennaSway, headY - 22);
      ctx.stroke();

      // アンテナ先端の光るポンポン
      ctx.fillStyle = trimColor;
      ctx.beginPath();
      ctx.arc(px + antennaSway, headY - 23, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // 2.6 バイザーと表情
      let faceOffsetX = 0;
      let faceOffsetY = 0;
      if (player.facing === 'left') faceOffsetX = -5;
      if (player.facing === 'right') faceOffsetX = 5;
      if (player.facing === 'up') faceOffsetY = -4;
      if (player.facing === 'down') faceOffsetY = 3;

      // 光沢バイザー
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.ellipse(px + faceOffsetX, headY + faceOffsetY, 9, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = trimColor;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // 目（向きとまばたきアニメーション）
      if (player.facing !== 'up') {
        if (this.isBlinking) {
          // まばたき（線目）
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(px + faceOffsetX - 5, headY + faceOffsetY);
          ctx.lineTo(px + faceOffsetX - 1, headY + faceOffsetY);
          ctx.moveTo(px + faceOffsetX + 1, headY + faceOffsetY);
          ctx.lineTo(px + faceOffsetX + 5, headY + faceOffsetY);
          ctx.stroke();
        } else {
          // パッチリ目＋白目ハイライト
          const eyeLookX = (player.facing === 'left') ? -1 : (player.facing === 'right') ? 1 : 0;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.ellipse(px + faceOffsetX - 3 + eyeLookX, headY + faceOffsetY, 1.8, 3, 0, 0, Math.PI * 2);
          ctx.ellipse(px + faceOffsetX + 3 + eyeLookX, headY + faceOffsetY, 1.8, 3, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.arc(px + faceOffsetX - 3 + eyeLookX, headY + faceOffsetY, 1.2, 0, Math.PI * 2);
          ctx.arc(px + faceOffsetX + 3 + eyeLookX, headY + faceOffsetY, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 2.7 復活パワー保持時の豪華なエンジェルオーラ
      if (player.hasRevive) {
        // 頭上に浮かぶゴールドの天使の輪
        const haloY = headY - 32 + Math.sin(now / 180) * 2;
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(px, haloY, 10, 4, 0, 0, Math.PI * 2);
        ctx.stroke();

        // 輝くハートのメディックバッジ
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('💖', px, haloY - 4);
      }

      // 2.8 復活直後の無敵シールドバリア
      if (player.isInvulnerable) {
        const shieldAlpha = 0.5 + Math.sin(now / 70) * 0.25;
        ctx.save();
        ctx.globalAlpha = shieldAlpha;

        const shieldGrad = ctx.createRadialGradient(px, charY, 14, px, charY, 26);
        shieldGrad.addColorStop(0, 'rgba(251, 191, 36, 0.1)');
        shieldGrad.addColorStop(0.7, 'rgba(251, 191, 36, 0.4)');
        shieldGrad.addColorStop(1, 'rgba(254, 240, 138, 0.9)');

        ctx.fillStyle = shieldGrad;
        ctx.beginPath();
        ctx.arc(px, charY, 26, 0, Math.PI * 2);
        ctx.fill();

        // シールド外周のテックリング
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, charY, 26, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
      }

      // 2.9 名札 & YOUマーカー描画
      this.drawPlayerTag(ctx, player, px, charY - 26, myPlayerId);

      ctx.restore();
    }
  }

  // 名札とチームバッジの描画
  drawPlayerTag(ctx, player, px, tagY, myPlayerId) {
    const isMe = (player.id === myPlayerId);

    // YOUインジケーター（下向き三角矢印）
    if (isMe && player.alive) {
      const arrowY = tagY - 14 + Math.sin(Date.now() / 150) * 3;
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.moveTo(px, arrowY);
      ctx.lineTo(px - 6, arrowY - 7);
      ctx.lineTo(px + 6, arrowY - 7);
      ctx.closePath();
      ctx.fill();
    }

    // ネームプレートの背景ピル
    ctx.font = 'bold 11px sans-serif';
    const textWidth = ctx.measureText(player.name).width;
    const pillW = textWidth + 16;
    const pillH = 16;
    const pillX = px - pillW / 2;
    const pillY = tagY - 11;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, 8);
    ctx.fill();

    // チーム所属に応じたボーダー
    if (player.team === 'blue') {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (player.team === 'red') {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // プレイヤー名文字
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isMe ? '#fef08a' : '#ffffff';
    ctx.fillText(player.name, px, tagY - 3);
  }
}

window.GameRenderer = GameRenderer;