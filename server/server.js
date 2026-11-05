const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);

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
        if (isVirtual) score -= 5;
        candidates.push({ name, address: addr, score });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function getPrimaryLanIp() {
  const ips = getLanIps();
  return ips.length > 0 ? ips[0].address : 'localhost';
}

// PeerJS ブラウザ用バンドルを静的配信
app.use('/peerjs', express.static(
  path.join(__dirname, '..', 'node_modules', 'peerjs', 'dist')
));

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, '..', 'public')));

// サーバー情報・QRコード提供API
// ※ WebRTC P2P 移行後もQRコード生成に利用
app.get('/api/info', async (req, res) => {
  try {
    const room = req.query.room || '';
    const primaryIp = getPrimaryLanIp();
    const lanIps = getLanIps();

    const hostHeader = req.headers.host || '';
    const hostWithoutPort = hostHeader.split(':')[0].toLowerCase();
    const isLoopback = !hostWithoutPort
      || hostWithoutPort === 'localhost'
      || hostWithoutPort === '127.0.0.1'
      || hostWithoutPort === '::1';

    let shareBaseUrl;
    if (isCodespaces && codespaceUrl) {
      if (!isLoopback && hostHeader
        && (hostHeader.includes('.github.dev') || hostHeader.includes('.app.github.dev'))) {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        shareBaseUrl = `${protocol}://${hostHeader}`;
      } else {
        shareBaseUrl = codespaceUrl;
      }
    } else if (isLoopback) {
      shareBaseUrl = `http://${primaryIp}:${PORT}`;
    } else {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      shareBaseUrl = `${protocol}://${hostHeader}`;
    }

    // room が空（ホスト ID 未確定）のときは QR 生成をスキップ
    const shareUrl = room
      ? `${shareBaseUrl}/?room=${encodeURIComponent(room)}`
      : shareBaseUrl;
    const qrDataUrl = room
      ? await QRCode.toDataURL(shareUrl, { margin: 1, scale: 6 })
      : null;

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

server.listen(PORT, HOST, async () => {
  const primaryIp = getPrimaryLanIp();
  const lanIps = getLanIps();
  const localUrl = `http://localhost:${PORT}/`;
  const shareBaseUrl = (isCodespaces && codespaceUrl)
    ? codespaceUrl
    : `http://${primaryIp}:${PORT}`;

  console.log('========================================================');
  console.log('💣 ボンバーマン マルチプレイヤー (WebRTC P2P) 起動！ 💣');
  console.log(`📡 バインドホスト:     ${HOST}:${PORT}`);

  if (isCodespaces) {
    console.log('☁️ 実行環境:           GitHub Codespaces');
    console.log(`🌐 ローカルURL:        ${localUrl}`);
    console.log(`🔗 共有ベースURL:      ${shareBaseUrl}/`);
    console.log('');
    console.log('--------------------------------------------------------');
    console.log('📢 【重要: 他のプレイヤーを接続させるための必須手順】');
    console.log('1. VS Code（Codespaces）下部パネルの「PORTS (ポート)」タブを開く');
    console.log(`2. ポート「${PORT}」の行を探す`);
    console.log('3.「Visibility (可視性)」列を右クリック → 「Port Visibility」→「Public」に変更');
    console.log('   ※ デフォルトの「Private」のままだと他のプレイヤーがアクセスできません。');
    console.log('--------------------------------------------------------');
  } else {
    console.log('🏠 実行環境:           ローカルPC / LAN');
    console.log(`🌐 ホストPC自身で開く: ${localUrl}`);
    console.log(`📱 LAN内 (他PC/スマホ): ${shareBaseUrl}/`);

    if (lanIps.length > 1) {
      console.log('--- その他のネットワークインターフェース ---');
      lanIps.slice(1).forEach((item) => {
        console.log(`   - [${item.name}] http://${item.address}:${PORT}/`);
      });
    }
  }

  console.log('');
  console.log('🔵 接続方式: WebRTC P2P (PeerJS)');
  console.log('   ホストがルームを作成すると招待リンクが自動生成されます。');
  console.log('========================================================');
});
