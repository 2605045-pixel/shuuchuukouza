const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const GameRoom = require('./game/GameRoom');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// GitHub Codespaces 環境判定
const isCodespaces = process.env.CODESPACES === 'true';
const codespaceName = process.env.CODESPACE_NAME;
const codespaceDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
const codespaceUrl = (isCodespaces && codespaceName)
  ? `https://${codespaceName}-${PORT}.${codespaceDomain}`
  : null;

/**
 * LAN 内のローカル IPv4 アドレス候補を取得して優先度順に並べる
 * 優先度:
 * 1. 192.168.x.x (家庭・小規模オフィスのWi-Fi/LANで最も一般的)
 * 2. 10.x.x.x (社内LANや一部のプライベートネットワーク)
 * 3. 172.16.x.x - 172.31.x.x (プライベートIP範囲)
 * 4. その他外部・非内部IPv4
 * ※ docker, veth, vmnet, vbox, tailscale 等の仮想NICはスコアを下げて優先度を落とす
 */
function getLanIps() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    const isVirtual = /docker|veth|vmnet|virtualbox|vbox|br-|tailscale/i.test(name);

    for (const iface of interfaces[name]) {
      const isIPv4 = iface.family === 'IPv4' || iface.family === 4;
      if (isIPv4 && !iface.internal) {
        let score = 1;
        const addr = iface.address;
        if (/^192\.168\./.test(addr)) {
          score = 10;
        } else if (/^10\./.test(addr)) {
          score = 8;
        } else if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(addr)) {
          score = 6;
        }

        if (isVirtual) {
          score -= 5;
        }

        candidates.push({
          name,
          address: addr,
          score,
        });
      }
    }
  }

  // スコア順に降順ソート
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function getPrimaryLanIp() {
  const ips = getLanIps();
  return ips.length > 0 ? ips[0].address : 'localhost';
}

// ルーム管理
const rooms = new Map(); // roomId => GameRoom

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new GameRoom(roomId, io));
  }
  return rooms.get(roomId);
}

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, '..', 'public')));

// サーバー情報・QRコード提供API
app.get('/api/info', async (req, res) => {
  try {
    const room = req.query.room || 'main';
    const primaryIp = getPrimaryLanIp();
    const lanIps = getLanIps();

    const hostHeader = req.headers.host || '';
    const hostWithoutPort = hostHeader.split(':')[0].toLowerCase();
    // ホストPC自身が localhost や 127.0.0.1 で開いているかを判定
    const isLoopback = !hostWithoutPort || hostWithoutPort === 'localhost' || hostWithoutPort === '127.0.0.1' || hostWithoutPort === '::1';

    let shareBaseUrl;
    if (isCodespaces && codespaceUrl) {
      // Codespaces環境の場合:
      // クライアントが既にCodespaces公開ドメイン経由でアクセスしている場合はそのホストを使用、
      // 内部ポート転送やlocalhost経由でアクセスしている場合でもCodespaces公開URLを優先
      if (!isLoopback && hostHeader && (hostHeader.includes('.github.dev') || hostHeader.includes('.app.github.dev'))) {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        shareBaseUrl = `${protocol}://${hostHeader}`;
      } else {
        shareBaseUrl = codespaceUrl;
      }
    } else if (isLoopback) {
      // ローカルPC環境でlocalhostアクセスの場合はLAN IPv4を使用
      shareBaseUrl = `http://${primaryIp}:${PORT}`;
    } else {
      // 外部ドメインや既にLAN IPでアクセスしている場合はそのホストを使用
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      shareBaseUrl = `${protocol}://${hostHeader}`;
    }

    const shareUrl = `${shareBaseUrl}/?room=${encodeURIComponent(room)}`;
    const qrDataUrl = await QRCode.toDataURL(shareUrl, { margin: 1, scale: 6 });

    res.json({
      isCodespaces,
      codespaceUrl,
      lanIp: primaryIp,
      port: PORT,
      shareBaseUrl,
      shareUrl,
      qrDataUrl,
      isLoopback,
      allIps: lanIps.map(c => c.address),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.IO 通信
io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('join_room', ({ roomId = 'main', name }) => {
    currentRoomId = roomId;
    socket.join(roomId);

    const room = getOrCreateRoom(roomId);
    const player = room.addPlayer(socket.id, name);

    socket.emit('joined_room', {
      playerId: player.id,
      roomId,
      isHost: room.hostSocketId === socket.id,
      player: player.toDTO(),
    });
  });

  socket.on('player_input', (input) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      room.handleInput(socket.id, input);
    }
  });

  socket.on('place_bomb', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      room.placeBomb(socket.id);
    }
  });

  socket.on('start_game', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      const res = room.startGame(socket.id);
      if (!res.success) {
        socket.emit('error_message', res.message);
      }
    }
  });

  socket.on('restart_game', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      room.restartGame(socket.id);
    }
  });

  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      room.removePlayer(socket.id);
      if (room.players.size === 0) {
        room.stopLoop();
        rooms.delete(currentRoomId);
      }
    }
  });
});

server.listen(PORT, HOST, async () => {
  const primaryIp = getPrimaryLanIp();
  const lanIps = getLanIps();
  const defaultRoom = 'main';
  const localUrl = `http://localhost:${PORT}/?room=${defaultRoom}`;
  const shareTargetUrl = (isCodespaces && codespaceUrl)
    ? `${codespaceUrl}/?room=${defaultRoom}`
    : `http://${primaryIp}:${PORT}/?room=${defaultRoom}`;

  console.log('========================================================');
  console.log('💣 ボンバーマン マルチプレイヤーサーバー起動！ 💣');
  console.log(`📡 バインドホスト:     ${HOST}:${PORT} (0.0.0.0 で外部接続を許可)`);

  if (isCodespaces) {
    console.log('☁️ 実行環境:           GitHub Codespaces');
    console.log(`🌐 ローカルURL:        ${localUrl}`);
    console.log(`🔗 共有リンク:         ${shareTargetUrl}`);
    console.log('');
    console.log('--------------------------------------------------------');
    console.log('📢 【重要: 他のプレイヤーを接続させるための必須手順】');
    console.log('1. VS Code（Codespaces）下部パネルの「PORTS (ポート)」タブを開く');
    console.log(`2. ポート「${PORT}」の行を探す`);
    console.log('3.「Visibility (可視性)」列を右クリック、または地球アイコンをクリック');
    console.log('4.「Port Visibility」を「Public (パブリック)」に変更する！');
    console.log('   ※ デフォルトの「Private」のままだと、他のプレイヤーがアクセスできません。');
    console.log('--------------------------------------------------------');
    console.log('');
  } else {
    console.log('🏠 実行環境:           ローカルPC / LAN');
    console.log(`🌐 ホストPC自身で開く: ${localUrl}`);
    console.log(`📱 LAN内 (他PC/スマホ): ${shareTargetUrl}`);

    if (lanIps.length > 1) {
      console.log('--- 検出されたその他のネットワークインターフェース ---');
      lanIps.slice(1).forEach((item) => {
        console.log(`   - [${item.name}] http://${item.address}:${PORT}/?room=${defaultRoom}`);
      });
    }

    if (primaryIp === 'localhost' || primaryIp === '127.0.0.1') {
      console.log('⚠️  注意: LAN接続用のIPv4アドレスが検出されませんでした。');
      console.log('   同じWi-Fiまたは有線LANに接続されているか確認してください。');
    }
  }

  try {
    const qrString = await QRCode.toString(shareTargetUrl, { type: 'terminal', small: true });
    console.log('接続用QRコード (カメラやスマホでスキャン):');
    console.log(qrString);
  } catch (e) {
    // ignore
  }
  console.log('========================================================');
});
