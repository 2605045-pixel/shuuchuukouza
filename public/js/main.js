document.addEventListener('DOMContentLoaded', async () => {
  const socket = io(window.location.origin, {
    transports: ['websocket', 'polling'],
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err);
  });

  let myPlayerId = null;
  let currentRoomId = 'main';
  let isHost = false;
  let currentGameState = null;
  let currentGrid = null; // クライアント側で永続キャッシュされるマップデータ
  let currentGridVersion = -1;

  // 滑らかな座標補間（Lerp）用の位置トラッカー
  const playerLerpPositions = new Map(); // id => { x, y, targetX, targetY, lastUpdate }

  // DOM要素
  const lobbyScreen = document.getElementById('lobbyScreen');
  const gameScreen = document.getElementById('gameScreen');
  const playerNameInput = document.getElementById('playerNameInput');
  const roomInput = document.getElementById('roomInput');
  const joinBtn = document.getElementById('joinBtn');
  const inviteSection = document.getElementById('inviteSection');
  const codespacesNotice = document.getElementById('codespacesNotice');
  const qrCodeImg = document.getElementById('qrCodeImg');
  const inviteUrlInput = document.getElementById('inviteUrlInput');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const copyInviteHeaderBtn = document.getElementById('copyInviteHeaderBtn');
  const lobbyPlayersSection = document.getElementById('lobbyPlayersSection');
  const lobbyPlayerList = document.getElementById('lobbyPlayerList');
  const playerCount = document.getElementById('playerCount');
  const startGameBtn = document.getElementById('startGameBtn');
  const waitingHostNotice = document.getElementById('waitingHostNotice');
  const currentRoomBadge = document.getElementById('currentRoomBadge');

  // 設定・チームDOM要素
  const gameSettingsSection = document.getElementById('gameSettingsSection');
  const modeSelectorGroup = document.getElementById('modeSelectorGroup');
  const themeSelect = document.getElementById('themeSelect');
  const teamSelectionSection = document.getElementById('teamSelectionSection');
  const blueTeamList = document.getElementById('blueTeamList');
  const redTeamList = document.getElementById('redTeamList');
  const blueTeamCount = document.getElementById('blueTeamCount');
  const redTeamCount = document.getElementById('redTeamCount');
  const joinBlueBtn = document.getElementById('joinBlueBtn');
  const joinRedBtn = document.getElementById('joinRedBtn');

  // HUD要素
  const teamMatchHeader = document.getElementById('teamMatchHeader');
  const blueTeamScore = document.getElementById('blueTeamScore');
  const redTeamScore = document.getElementById('redTeamScore');
  const blueTeamMembers = document.getElementById('blueTeamMembers');
  const redTeamMembers = document.getElementById('redTeamMembers');

  const myColorDot = document.getElementById('myColorDot');
  const myNameDisplay = document.getElementById('myNameDisplay');
  const myStatusBadge = document.getElementById('myStatusBadge');
  const statBombs = document.getElementById('statBombs');
  const statRange = document.getElementById('statRange');
  const statSpeed = document.getElementById('statSpeed');
  const statKickBadge = document.getElementById('statKickBadge');
  const statKickText = document.getElementById('statKickText');
  const statReviveBadge = document.getElementById('statReviveBadge');
  const hudReviveBtn = document.getElementById('hudReviveBtn');
  const hudScoreList = document.getElementById('hudScoreList');
  const combatToast = document.getElementById('combatToast');

  // モバイル要素
  const mobileReviveBtn = document.getElementById('mobileReviveBtn');

  // モーダル
  const gameOverModal = document.getElementById('gameOverModal');
  const modalIcon = document.getElementById('modalIcon');
  const modalTitle = document.getElementById('modalTitle');
  const modalSubtitle = document.getElementById('modalSubtitle');
  const modalTeamScores = document.getElementById('modalTeamScores');
  const modalBlueScore = document.getElementById('modalBlueScore');
  const modalRedScore = document.getElementById('modalRedScore');
  const modalScoreList = document.getElementById('modalScoreList');
  const modalRestartBtn = document.getElementById('modalRestartBtn');

  const helpModal = document.getElementById('helpModal');
  const controlsHelpBtn = document.getElementById('controlsHelpBtn');
  const closeHelpBtn = document.getElementById('closeHelpBtn');
  const soundToggleBtn = document.getElementById('soundToggleBtn');

  // レンダラーとキャンバス
  const canvas = document.getElementById('gameCanvas');
  const renderer = new window.GameRenderer(canvas);

  // ESCメニュー / ポーズモーダル DOM
  const pauseModal = document.getElementById('pauseModal');
  const pauseResumeBtn = document.getElementById('pauseResumeBtn');
  const pauseGiveUpBtn = document.getElementById('pauseGiveUpBtn');
  const hudOptionsBtn = document.getElementById('hudOptionsBtn');
  const mapVoteBanner = document.getElementById('mapVoteBanner');
  const voteBannerTitle = document.getElementById('voteBannerTitle');
  const voteBannerStatus = document.getElementById('voteBannerStatus');
  const voteYesBtn = document.getElementById('voteYesBtn');
  const voteNoBtn = document.getElementById('voteNoBtn');

  let isPauseMenuOpen = false;

  function openPauseMenu() {
    if (!currentGameState || currentGameState.state !== 'PLAYING') return;
    isPauseMenuOpen = true;
    pauseModal.classList.add('active');
  }

  function closePauseMenu() {
    isPauseMenuOpen = false;
    pauseModal.classList.remove('active');
  }

  function togglePauseMenu() {
    if (isPauseMenuOpen) {
      closePauseMenu();
    } else {
      openPauseMenu();
    }
  }

  // 入力マネージャー (移動, 爆弾, 復活[R], ESC)
  const inputManager = new window.InputManager(
    (inputState) => {
      socket.emit('player_input', inputState);
    },
    () => {
      socket.emit('place_bomb');
    },
    () => {
      socket.emit('use_revive');
    },
    () => {
      // ESCキー: ヘルプモーダルが開いていれば閉じる、ゲームオーバーモーダルも同様、それ以外はポーズメニュー切替
      if (helpModal.classList.contains('active')) {
        helpModal.classList.remove('active');
      } else if (gameOverModal.classList.contains('active')) {
        // ゲームオーバーモーダルはESCで閉じない
      } else {
        togglePauseMenu();
      }
    }
  );

  // HUD & モバイルの復活ボタンクリック
  if (hudReviveBtn) {
    hudReviveBtn.addEventListener('click', () => {
      socket.emit('use_revive');
    });
  }

  // ポーズメニューボタンハンドラー
  if (hudOptionsBtn) {
    hudOptionsBtn.addEventListener('click', () => {
      togglePauseMenu();
    });
  }

  if (pauseResumeBtn) {
    pauseResumeBtn.addEventListener('click', () => {
      closePauseMenu();
    });
  }

  if (pauseGiveUpBtn) {
    pauseGiveUpBtn.addEventListener('click', () => {
      if (confirm('本当に降参しますか？')) {
        socket.emit('give_up');
        closePauseMenu();
      }
    });
  }

  // マップ変更投票ボタン（ポーズメニュー内）
  document.querySelectorAll('.map-vote-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.getAttribute('data-vote-theme');
      if (theme) {
        socket.emit('vote_map_change', { theme });
        closePauseMenu();
      }
    });
  });

  // マップ変更投票: 賛成 / 反対ボタン
  if (voteYesBtn) {
    voteYesBtn.addEventListener('click', () => {
      socket.emit('cast_map_vote', { agree: true });
    });
  }
  if (voteNoBtn) {
    voteNoBtn.addEventListener('click', () => {
      socket.emit('cast_map_vote', { agree: false });
    });
  }

  // URLパラメータチェック
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('room')) {
    roomInput.value = urlParams.get('room');
  }
  if (urlParams.get('name')) {
    playerNameInput.value = urlParams.get('name');
  }

  // 招待情報更新
  let debounceTimer = null;
  async function updateInviteInfo(roomId) {
    const targetRoom = roomId || roomInput.value.trim() || 'main';
    const currentOrigin = window.location.origin;
    const isCodespaceBrowser = window.location.hostname.includes('.github.dev') || window.location.hostname.includes('.app.github.dev');

    try {
      const res = await fetch(`/api/info?room=${encodeURIComponent(targetRoom)}`);
      const info = await res.json();

      let finalShareUrl = info.shareUrl;
      if (isCodespaceBrowser) {
        finalShareUrl = `${currentOrigin}/?room=${encodeURIComponent(targetRoom)}`;
      }

      if (finalShareUrl) {
        inviteUrlInput.value = finalShareUrl;
      }
      if (info.qrDataUrl) {
        qrCodeImg.src = info.qrDataUrl;
      }

      if (codespacesNotice && (info.isCodespaces || isCodespaceBrowser)) {
        codespacesNotice.style.display = 'block';
      }
    } catch (err) {
      console.warn('API /api/info 取得失敗:', err);
      inviteUrlInput.value = `${currentOrigin}/?room=${encodeURIComponent(targetRoom)}`;
      if (codespacesNotice && isCodespaceBrowser) {
        codespacesNotice.style.display = 'block';
      }
    }
  }

  updateInviteInfo();

  roomInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      updateInviteInfo(roomInput.value.trim());
    }, 250);
  });

  function copyInviteLink(buttonEl) {
    const url = inviteUrlInput.value;
    if (!url) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        showCopySuccess(buttonEl);
      }).catch(() => {
        fallbackCopy(buttonEl);
      });
    } else {
      fallbackCopy(buttonEl);
    }
  }

  function fallbackCopy(buttonEl) {
    inviteUrlInput.select();
    document.execCommand('copy');
    showCopySuccess(buttonEl);
  }

  function showCopySuccess(buttonEl) {
    if (!buttonEl) return;
    const orig = buttonEl.textContent;
    buttonEl.textContent = 'コピー完了！';
    setTimeout(() => {
      buttonEl.textContent = orig;
    }, 1800);
  }

  copyUrlBtn.addEventListener('click', () => copyInviteLink(copyUrlBtn));
  if (copyInviteHeaderBtn) {
    copyInviteHeaderBtn.addEventListener('click', () => copyInviteLink(copyInviteHeaderBtn));
  }

  // サウンド切替
  soundToggleBtn.addEventListener('click', () => {
    const muted = window.soundManager.toggleMute();
    soundToggleBtn.textContent = muted ? '🔇' : '🔊';
  });
  if (window.soundManager.muted) {
    soundToggleBtn.textContent = '🔇';
  }

  // ヘルプモーダル
  controlsHelpBtn.addEventListener('click', () => helpModal.classList.add('active'));
  closeHelpBtn.addEventListener('click', () => helpModal.classList.remove('active'));

  // トースト通知関数
  let toastTimer = null;
  function showToast(message, type = 'info') {
    if (!combatToast) return;
    combatToast.textContent = message;
    combatToast.className = `combat-toast active toast-${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      combatToast.classList.remove('active');
    }, 2800);
  }

  // ロビー参加
  joinBtn.addEventListener('click', () => {
    window.soundManager.init();
    const name = playerNameInput.value.trim();
    const roomId = roomInput.value.trim() || 'main';
    currentRoomId = roomId;

    socket.emit('join_room', { roomId, name });
    joinBtn.disabled = true;
    joinBtn.textContent = '参加中...';
  });

  // ゲームモード切替チップ
  const modeChips = document.querySelectorAll('.mode-chip');
  modeChips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (!isHost) return;
      const mode = chip.getAttribute('data-mode');
      socket.emit('set_game_mode', { mode });
    });
  });

  // マップテーマ切替
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      if (!isHost) return;
      socket.emit('set_map_theme', { theme: themeSelect.value });
    });
  }

  // チーム参加ボタン
  if (joinBlueBtn) {
    joinBlueBtn.addEventListener('click', () => {
      socket.emit('join_team', { team: 'blue' });
    });
  }
  if (joinRedBtn) {
    joinRedBtn.addEventListener('click', () => {
      socket.emit('join_team', { team: 'red' });
    });
  }

  // ゲーム開始
  startGameBtn.addEventListener('click', () => {
    socket.emit('start_game');
  });

  // 再戦ボタン
  modalRestartBtn.addEventListener('click', () => {
    gameOverModal.classList.remove('active');
    socket.emit('restart_game');
  });

  // Socket.IO イベントハンドラ
  socket.on('joined_room', (data) => {
    myPlayerId = data.playerId;
    isHost = data.isHost;

    updateInviteInfo(data.roomId);
    if (currentRoomBadge) {
      currentRoomBadge.textContent = `Room: ${data.roomId}`;
    }

    inviteSection.style.display = 'block';
    gameSettingsSection.style.display = 'block';
    lobbyPlayersSection.style.display = 'block';
    joinBtn.style.display = 'none';
    playerNameInput.disabled = true;
    roomInput.disabled = true;

    updateLobbyButtons();
  });

  function updateLobbyButtons() {
    if (isHost) {
      startGameBtn.style.display = 'block';
      waitingHostNotice.style.display = 'none';
      modeChips.forEach(c => c.removeAttribute('disabled'));
      if (themeSelect) themeSelect.removeAttribute('disabled');
    } else {
      startGameBtn.style.display = 'none';
      waitingHostNotice.style.display = 'block';
      modeChips.forEach(c => c.setAttribute('disabled', 'true'));
      if (themeSelect) themeSelect.setAttribute('disabled', 'true');
    }
  }

  // ロビー状態更新
  socket.on('lobby_state', (data) => {
    if (data.hostSocketId) {
      isHost = (myPlayerId === data.hostSocketId);
      updateLobbyButtons();
    }

    const mode = data.gameMode || 'team2v2';
    const isTeamMode = (mode !== 'ffa');

    // モードチップのアクティブ表示
    modeChips.forEach(chip => {
      if (chip.getAttribute('data-mode') === mode) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });

    // マップテーマの同期
    if (themeSelect && data.mapTheme) {
      themeSelect.value = data.mapTheme;
    }

    const players = data.players || [];
    playerCount.textContent = players.length;

    // チーム選択パネルの表示制御
    if (isTeamMode) {
      teamSelectionSection.style.display = 'block';
      const maxPerTeam = (mode === 'team2v2') ? 2 : 3;

      const bluePlayers = players.filter(p => p.team === 'blue');
      const redPlayers = players.filter(p => p.team === 'red');

      blueTeamCount.textContent = `${bluePlayers.length}/${maxPerTeam}`;
      redTeamCount.textContent = `${redPlayers.length}/${maxPerTeam}`;

      renderTeamRoster(blueTeamList, bluePlayers, data.hostSocketId, 'blue');
      renderTeamRoster(redTeamList, redPlayers, data.hostSocketId, 'red');
    } else {
      teamSelectionSection.style.display = 'none';
    }

    // 全体プレイヤーリスト更新
    lobbyPlayerList.innerHTML = '';
    players.forEach((p) => {
      const li = document.createElement('li');
      li.style.borderLeftColor = p.color;

      const tag = document.createElement('div');
      tag.className = 'player-info-tag';

      const dot = document.createElement('span');
      dot.className = 'player-color-dot';
      dot.style.backgroundColor = p.color;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.name;

      tag.appendChild(dot);
      tag.appendChild(nameSpan);

      const badges = document.createElement('div');
      badges.style.display = 'flex';
      badges.style.gap = '6px';

      if (p.team) {
        const tb = document.createElement('span');
        tb.className = `team-badge team-${p.team}-badge`;
        tb.textContent = p.team === 'blue' ? 'BLUE' : 'RED';
        badges.appendChild(tb);
      }

      if (p.id === data.hostSocketId) {
        const hb = document.createElement('span');
        hb.className = 'host-badge';
        hb.textContent = 'HOST';
        badges.appendChild(hb);
      }

      if (p.id === myPlayerId) {
        const yb = document.createElement('span');
        yb.className = 'you-badge';
        yb.textContent = 'YOU';
        badges.appendChild(yb);
      }

      li.appendChild(tag);
      li.appendChild(badges);
      lobbyPlayerList.appendChild(li);
    });
  });

  function renderTeamRoster(container, playerList, hostId, teamName) {
    container.innerHTML = '';
    if (playerList.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty-slot-text';
      empty.textContent = '（空きスロット）';
      container.appendChild(empty);
      return;
    }

    playerList.forEach(p => {
      const li = document.createElement('li');
      li.className = 'team-roster-item';

      const namePart = document.createElement('span');
      namePart.textContent = p.name;

      const badgePart = document.createElement('div');
      badgePart.style.display = 'flex';
      badgePart.style.gap = '4px';

      if (p.id === myPlayerId) {
        const youBadge = document.createElement('span');
        youBadge.className = 'you-badge mini';
        youBadge.textContent = 'YOU';
        badgePart.appendChild(youBadge);
      }
      if (p.id === hostId) {
        const hostBadge = document.createElement('span');
        hostBadge.className = 'host-badge mini';
        hostBadge.textContent = 'HOST';
        badgePart.appendChild(hostBadge);
      }

      li.appendChild(namePart);
      li.appendChild(badgePart);
      container.appendChild(li);
    });
  }

  // ゲーム開始イベント
  socket.on('game_started', (data) => {
    lobbyScreen.classList.remove('active');
    gameScreen.classList.add('active');
    gameOverModal.classList.remove('active');

    if (data.grid) {
      currentGrid = data.grid;
      currentGridVersion = data.gridVersion || 1;
    }

    // チーム戦ヘッダーの表示切り替え
    const isTeam = data.gameMode && data.gameMode !== 'ffa';
    teamMatchHeader.style.display = isTeam ? 'flex' : 'none';

    showToast('⚔️ ラウンド開始！ 爆弾を置いて戦え！', 'info');
  });

  // サーバー状態受信（30Hzで効率的に受信）
  socket.on('game_state', (state) => {
    currentGameState = state;

    // グリッドが更新されている場合はクライアントキャッシュを更新
    if (state.grid) {
      currentGrid = state.grid;
      currentGridVersion = state.gridVersion;
    }
    state.grid = currentGrid; // レンダラーには常に保持しているグリッドを渡す

    if (state.state === 'PLAYING') {
      if (!gameScreen.classList.contains('active')) {
        lobbyScreen.classList.remove('active');
        gameScreen.classList.add('active');
      }
    }

    // 各プレイヤーの目標座標を記録（Lerp補間用）
    if (state.players) {
      const now = Date.now();
      state.players.forEach(p => {
        if (!playerLerpPositions.has(p.id)) {
          playerLerpPositions.set(p.id, {
            x: p.x,
            y: p.y,
            targetX: p.x,
            targetY: p.y,
            lastUpdate: now,
          });
        } else {
          const lerp = playerLerpPositions.get(p.id);
          lerp.targetX = p.x;
          lerp.targetY = p.y;
          lerp.lastUpdate = now;
        }
      });
    }

    // HUDの更新（ダーティチェック付きでDOM負荷を最小化）
    updateHUD(state);
  });

  // ==========================================
  // 高速リクエストアニメーションフレーム描画ループ（60fps+ 滑らか動作！）
  // ==========================================
  function renderLoop() {
    if (currentGameState && gameScreen.classList.contains('active')) {
      // プレイヤー座標の滑らかな線形補間（Lerp）
      const interpolatedPlayers = (currentGameState.players || []).map(p => {
        const lerp = playerLerpPositions.get(p.id);
        if (lerp) {
          // Lerp係数 (30Hz配信を60-144fpsに超滑らかに補間)
          lerp.x += (lerp.targetX - lerp.x) * 0.4;
          lerp.y += (lerp.targetY - lerp.y) * 0.4;
          return {
            ...p,
            x: lerp.x,
            y: lerp.y,
          };
        }
        return p;
      });

      renderer.render(currentGameState, myPlayerId, interpolatedPlayers);
    }
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);

  // HUDの効率的更新
  let prevHudState = {};
  function updateHUD(state) {
    const isTeam = state.gameMode && state.gameMode !== 'ffa';

    // チーム戦ヘッダー
    if (isTeam && state.teamScores) {
      if (teamMatchHeader.style.display !== 'flex') teamMatchHeader.style.display = 'flex';
      blueTeamScore.textContent = state.teamScores.blue || 0;
      redTeamScore.textContent = state.teamScores.red || 0;

      // チームメンバー生存ドット表示
      const bluePlayers = (state.players || []).filter(p => p.team === 'blue');
      const redPlayers = (state.players || []).filter(p => p.team === 'red');

      blueTeamMembers.innerHTML = bluePlayers.map(p =>
        `<span class="member-dot ${p.alive ? 'alive' : 'dead'}" title="${p.name} (${p.alive ? '生存' : '撃破'})"></span>`
      ).join('');

      redTeamMembers.innerHTML = redPlayers.map(p =>
        `<span class="member-dot ${p.alive ? 'alive' : 'dead'}" title="${p.name} (${p.alive ? '生存' : '撃破'})"></span>`
      ).join('');
    } else {
      if (teamMatchHeader.style.display !== 'none') teamMatchHeader.style.display = 'none';
    }

    // 自分自身のステータス
    const me = state.players ? state.players.find(p => p.id === myPlayerId) : null;
    if (me) {
      myColorDot.style.backgroundColor = me.color;
      myNameDisplay.textContent = me.name;

      if (me.alive) {
        myStatusBadge.className = 'status-badge alive';
        myStatusBadge.textContent = 'ALIVE';
      } else {
        myStatusBadge.className = 'status-badge dead';
        myStatusBadge.textContent = 'DEAD';
      }

      if (me.stats) {
        statBombs.textContent = me.stats.maxBombs;
        statRange.textContent = me.stats.bombRange;
        statSpeed.textContent = me.stats.speed.toFixed(1);

        if (me.stats.canKick) {
          statKickBadge.classList.add('active');
          statKickText.textContent = 'KICK ON';
        } else {
          statKickBadge.classList.remove('active');
          statKickText.textContent = 'KICK OFF';
        }

        // 復活パワー所持表示
        const hasRevive = !!me.hasRevive;
        if (hasRevive) {
          statReviveBadge.classList.add('active');
          statReviveBadge.style.display = 'inline-flex';
          if (mobileReviveBtn) mobileReviveBtn.style.display = 'flex';

          // 同じチームに死者がいる場合はHUDの即時復活ボタンをパルス表示
          if (isTeam) {
            const hasDeadTeammate = (state.players || []).some(p => p.team === me.team && !p.alive);
            if (hasDeadTeammate) {
              hudReviveBtn.style.display = 'inline-flex';
              hudReviveBtn.classList.add('pulsing');
            } else {
              hudReviveBtn.style.display = 'none';
              hudReviveBtn.classList.remove('pulsing');
            }
          }
        } else {
          statReviveBadge.classList.remove('active');
          statReviveBadge.style.display = 'none';
          hudReviveBtn.style.display = 'none';
          if (mobileReviveBtn) mobileReviveBtn.style.display = 'none';
        }
      }
    }

    // スコアボード一覧
    if (state.players) {
      hudScoreList.innerHTML = '';
      state.players.forEach(p => {
        const item = document.createElement('div');
        item.className = 'score-item';
        const teamClass = p.team ? `team-${p.team}-text` : '';
        item.innerHTML = `<span class="player-color-dot" style="background:${p.color};width:8px;height:8px;"></span> <span class="${teamClass}">${p.name}</span>: <strong>${p.score}</strong>`;
        hudScoreList.appendChild(item);
      });
    }
  }

  // 蘇生イベント受信
  socket.on('player_revived', (data) => {
    // 蘇生者と被蘇生者の座標を取得して光線エフェクトを発生
    const reviver = currentGameState?.players?.find(p => p.id === data.reviverId);
    const target = currentGameState?.players?.find(p => p.id === data.targetId);

    const fromX = reviver ? reviver.x : (data.x || 300);
    const fromY = reviver ? reviver.y : (data.y || 300);
    const toX = target ? target.x : (data.x || 300);
    const toY = target ? target.y : (data.y || 300);

    renderer.addReviveBeam(fromX, fromY, toX, toY);
    window.soundManager.playRevive();

    showToast(`✨ ${data.reviverName} が味方 ${data.targetName} を復活！(3秒無敵)`, 'revive');
  });

  // 撃破イベント受信
  socket.on('player_eliminated', (data) => {
    const teamName = data.team ? (data.team === 'blue' ? 'Team Blue' : 'Team Red') : '';
    showToast(`💣 ${data.name} ${teamName ? `(${teamName}) ` : ''}が爆風に巻き込まれた！`, 'danger');
  });

  // サウンドイベント
  socket.on('sound_event', (evt) => {
    switch (evt.type) {
      case 'bomb_drop':
        window.soundManager.playBombDrop();
        break;
      case 'bomb_kick':
        window.soundManager.playBombKick();
        break;
      case 'explosion':
        window.soundManager.playExplosion();
        break;
      case 'item_reveal':
        window.soundManager.playItemReveal();
        break;
      case 'item_pickup':
        window.soundManager.playItemPickup();
        break;
      case 'player_death':
        window.soundManager.playPlayerDeath();
        break;
      case 'revive':
        window.soundManager.playRevive();
        break;
    }
  });

  // ゲーム終了（勝敗決定）
  socket.on('game_over', (data) => {
    gameOverModal.classList.add('active');

    const isTeam = (data.mode && data.mode !== 'ffa');

    if (data.draw) {
      modalIcon.textContent = '💥';
      modalTitle.textContent = 'DRAW!';
      modalSubtitle.textContent = '両者相打ち！引き分けです！';
    } else if (isTeam && data.winnerTeam) {
      const isMyTeamWinner = (currentGameState?.players?.find(p => p.id === myPlayerId)?.team === data.winnerTeam);
      modalIcon.textContent = isMyTeamWinner ? '🏆' : '💀';
      modalTitle.textContent = isMyTeamWinner ? 'VICTORY!' : 'DEFEATED...';
      modalSubtitle.textContent = `${data.winnerTeamName} の勝利！`;

      if (isMyTeamWinner) {
        window.soundManager.playVictory();
      }
    } else if (data.winner) {
      const isWinner = data.winner.id === myPlayerId;
      modalIcon.textContent = isWinner ? '🏆' : '💀';
      modalTitle.textContent = isWinner ? 'VICTORY!' : 'DEFEATED...';
      modalSubtitle.textContent = `${data.winner.name} の勝利！`;

      if (isWinner) {
        window.soundManager.playVictory();
      }
    }

    // チーム戦スコア表示
    if (isTeam && data.teamScores) {
      modalTeamScores.style.display = 'flex';
      modalBlueScore.textContent = data.teamScores.blue || 0;
      modalRedScore.textContent = data.teamScores.red || 0;
    } else {
      modalTeamScores.style.display = 'none';
    }

    // スコアリスト反映
    if (currentGameState && currentGameState.players) {
      modalScoreList.innerHTML = '';
      currentGameState.players
        .slice()
        .sort((a, b) => b.score - a.score)
        .forEach(p => {
          const li = document.createElement('li');
          const teamLabel = p.team ? ` [${p.team.toUpperCase()}]` : '';
          li.innerHTML = `<span style="color:${p.color}; font-weight:bold;">${p.name}${teamLabel}</span> <span>${p.score} 勝</span>`;
          modalScoreList.appendChild(li);
        });
    }
  });

  socket.on('error_message', (msg) => {
    alert(msg);
  });

  socket.on('toast_message', (msg) => {
    showToast(msg, 'warning');
  });
});