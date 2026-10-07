document.addEventListener('DOMContentLoaded', async () => {
  // ブラウザの現在のオリジン（Codespaces公開URLまたはローカルURL）を自動参照して接続
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

  // HUD要素
  const myColorDot = document.getElementById('myColorDot');
  const myNameDisplay = document.getElementById('myNameDisplay');
  const myStatusBadge = document.getElementById('myStatusBadge');
  const statBombs = document.getElementById('statBombs');
  const statRange = document.getElementById('statRange');
  const statSpeed = document.getElementById('statSpeed');
  const statKickBadge = document.getElementById('statKickBadge');
  const statKickText = document.getElementById('statKickText');
  const hudScoreList = document.getElementById('hudScoreList');

  // モーダル
  const gameOverModal = document.getElementById('gameOverModal');
  const modalIcon = document.getElementById('modalIcon');
  const modalTitle = document.getElementById('modalTitle');
  const modalSubtitle = document.getElementById('modalSubtitle');
  const modalScoreList = document.getElementById('modalScoreList');
  const modalRestartBtn = document.getElementById('modalRestartBtn');

  const helpModal = document.getElementById('helpModal');
  const controlsHelpBtn = document.getElementById('controlsHelpBtn');
  const closeHelpBtn = document.getElementById('closeHelpBtn');
  const soundToggleBtn = document.getElementById('soundToggleBtn');

  // レンダラーとキャンバス
  const canvas = document.getElementById('gameCanvas');
  const renderer = new window.GameRenderer(canvas);

  // 入力マネージャー
  const inputManager = new window.InputManager(
    (inputState) => {
      socket.emit('player_input', inputState);
    },
    () => {
      socket.emit('place_bomb');
    }
  );

  // URLパラメータ（?room=xxx&name=yyy）のチェック
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('room')) {
    roomInput.value = urlParams.get('room');
  }
  if (urlParams.get('name')) {
    playerNameInput.value = urlParams.get('name');
  }

  // 招待情報（Codespaces公開リンク/LAN IPリンク・QRコード）の取得と画面更新
  let debounceTimer = null;
  async function updateInviteInfo(roomId) {
    const targetRoom = roomId || roomInput.value.trim() || 'main';
    const currentOrigin = window.location.origin;
    const isCodespaceBrowser = window.location.hostname.includes('.github.dev') || window.location.hostname.includes('.app.github.dev');

    try {
      const res = await fetch(`/api/info?room=${encodeURIComponent(targetRoom)}`);
      const info = await res.json();

      // ブラウザがCodespacesの公開ドメインで開かれている場合はブラウザの現在のオリジンを優先
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

      // Codespaces環境の場合にPORTS公開のヒントを表示
      if (codespacesNotice && (info.isCodespaces || isCodespaceBrowser)) {
        codespacesNotice.style.display = 'block';
      }
    } catch (err) {
      console.warn('API /api/info 取得失敗。フォールバックURLを設定します:', err);
      inviteUrlInput.value = `${currentOrigin}/?room=${encodeURIComponent(targetRoom)}`;
      if (codespacesNotice && isCodespaceBrowser) {
        codespacesNotice.style.display = 'block';
      }
    }
  }

  // 初期ロード時にLAN IPリンクとQRコードを取得
  updateInviteInfo();

  // ルーム名入力時に招待リンク・QRコードを更新
  roomInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      updateInviteInfo(roomInput.value.trim());
    }, 250);
  });

  // URLコピー共通関数
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

  // URLコピーボタン
  copyUrlBtn.addEventListener('click', () => copyInviteLink(copyUrlBtn));
  if (copyInviteHeaderBtn) {
    copyInviteHeaderBtn.addEventListener('click', () => copyInviteLink(copyInviteHeaderBtn));
  }

  // サウンドトグルボタン
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

  // ロビー参加ボタン
  joinBtn.addEventListener('click', () => {
    window.soundManager.init(); // 最初のユーザーアクションでオーディオ有効化
    const name = playerNameInput.value.trim();
    const roomId = roomInput.value.trim() || 'main';
    currentRoomId = roomId;

    socket.emit('join_room', { roomId, name });
    joinBtn.disabled = true;
    joinBtn.textContent = '参加中...';
  });

  // ゲーム開始ボタン
  startGameBtn.addEventListener('click', () => {
    socket.emit('start_game');
  });

  // 再戦ボタン
  modalRestartBtn.addEventListener('click', () => {
    gameOverModal.classList.remove('active');
    socket.emit('restart_game');
  });

  // Socket.IO 受信イベント
  socket.on('joined_room', (data) => {
    myPlayerId = data.playerId;
    isHost = data.isHost;

    updateInviteInfo(data.roomId);
    inviteSection.style.display = 'block';
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
    } else {
      startGameBtn.style.display = 'none';
      waitingHostNotice.style.display = 'block';
    }
  }

  // ロビー状態更新
  socket.on('lobby_state', (data) => {
    if (data.hostSocketId) {
      isHost = (myPlayerId === data.hostSocketId);
      updateLobbyButtons();
    }

    const players = data.players || [];
    playerCount.textContent = players.length;
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

  // ゲーム開始
  socket.on('game_started', () => {
    lobbyScreen.classList.remove('active');
    gameScreen.classList.add('active');
    gameOverModal.classList.remove('active');
  });

  // ゲーム状態更新（毎フレーム）
  socket.on('game_state', (state) => {
    currentGameState = state;

    if (state.state === 'PLAYING') {
      if (!gameScreen.classList.contains('active')) {
        lobbyScreen.classList.remove('active');
        gameScreen.classList.add('active');
      }
    }

    // キャンバス描画
    renderer.render(state, myPlayerId);

    // 自プレイヤーのHUD情報更新
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
        // 設置可能数
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
      }
    }

    // スコアボード更新
    if (state.players) {
      hudScoreList.innerHTML = '';
      state.players.forEach(p => {
        const item = document.createElement('div');
        item.className = 'score-item';
        item.innerHTML = `<span class="player-color-dot" style="background:${p.color};width:8px;height:8px;"></span> ${p.name}: <strong>${p.score}</strong>`;
        hudScoreList.appendChild(item);
      });
    }
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
    }
  });

  // ゲーム終了（勝敗決定）
  socket.on('game_over', (data) => {
    gameOverModal.classList.add('active');

    if (data.draw) {
      modalIcon.textContent = '💥';
      modalTitle.textContent = 'DRAW!';
      modalSubtitle.textContent = '全員爆風に巻き込まれました...！';
    } else if (data.winner) {
      const isWinner = data.winner.id === myPlayerId;
      modalIcon.textContent = isWinner ? '🏆' : '💀';
      modalTitle.textContent = isWinner ? 'VICTORY!' : 'DEFEATED...';
      modalSubtitle.textContent = `${data.winner.name} の勝利！`;

      if (isWinner) {
        window.soundManager.playVictory();
      }
    }

    // スコアリスト反映
    if (currentGameState && currentGameState.players) {
      modalScoreList.innerHTML = '';
      currentGameState.players
        .slice()
        .sort((a, b) => b.score - a.score)
        .forEach(p => {
          const li = document.createElement('li');
          li.innerHTML = `<span style="color:${p.color}; font-weight:bold;">${p.name}</span> <span>${p.score} 勝</span>`;
          modalScoreList.appendChild(li);
        });
    }
  });

  socket.on('error_message', (msg) => {
    alert(msg);
  });
});
